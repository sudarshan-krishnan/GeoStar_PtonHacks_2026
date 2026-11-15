/*
 * SiteStar PROTECT - ESP32 building node (model dorm on cardboard)
 * -----------------------------------------------------------------
 * Board : ESP32 DevKit (WROOM-32). Arduino-ESP32 core 2.x or 3.x.
 * Libs  : Adafruit SSD1306, Adafruit GFX, DHT sensor library (+ Adafruit Unified Sensor).
 *
 * Rooms on the model (LED pair each, via 74HC595):
 *   R1 2F Bathroom   : soil-moisture leak sensor + servo shut-off valve + micro switch (valve really shut?)
 *   R2 B1 Mechanical : DHT11 (temp/humidity), pipe thermistor, sump level (ultrasonic), exhaust fan
 *   R3 1F Lounge     : light-beam smoke sensor, PIR occupancy, servo fire door (lounge -> corridor)
 *   R4 1F Corridor   : strobe (relay + white LEDs)
 *
 * SAFETY DESIGN: the leak and smoke reflexes live HERE, not in the AI. Water on the sensor closes
 * the valve within ~50 ms and smoke releases the fire door, even if the laptop is gone. The valve will not reopen while the probe
 * is still wet, whatever the laptop says (interlock). The AI does diagnosis, work orders,
 * vendor dispatch (with human approval) and can reopen only after the leak is cleared.
 *
 * ESP32 -> laptop (every 200 ms):
 *   I leak=812 wet=1 beam=640 base=900 smoke=0 t=24.0 rh=48 pipe=21.5 pir=1 lvl=18.2
 *     valve=0 vsw=1 door=0 bseq=2 up=93
 *   (valve/door: 1 open, 0 closed; vsw: 1 = micro switch pressed = valve physically shut;
 *    any sensor not fitted reports "-")
 * Laptop -> ESP32:
 *   A valve=1 fan=0.60 strobe=0 buzz=0 r=0,2,1,0 agent=1 door=1
 *     buzz 0 off / 1 alert chirps / 2 alarm; r = room states 0 ok,1 warn,2 alarm
 *     agent 0 idle / 1 thinking (purple) / 2 waiting for human (yellow) / 3 done (green)
 *   L line0|line1|...|line5   OLED text
 *   TEST | PING | RECAL (re-learn dry-probe and clear-beam baselines)
 */

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <SPI.h>
#include <MFRC522.h>
#include <DHT.h>
#include "servo_ch.h"
#include <Ticker.h>
#if __has_include("soc/rtc_cntl_reg.h")
#include "soc/rtc_cntl_reg.h"   // to switch off the brown-out reset (servos on USB power)
#endif
#if __has_include("esp_arduino_version.h")
#include "esp_arduino_version.h"
#endif
#ifndef ESP_ARDUINO_VERSION_MAJOR
#define ESP_ARDUINO_VERSION_MAJOR 2
#endif

// ---------------------------------------------------------------- pin map ---
// Grouped so every part's wires sit next to each other on one side of the board
// (see hardware/docs/protect_wiring.png).
// Left header, top to bottom
static const uint8_t PIN_BUTTON      = 36;  // VP: button to GND + EXTERNAL 10k pull-up (no internal pull-up)
static const uint8_t PIN_BEAM_SENSE  = 39;  // VN: photoresistor (to 3V3) / 10k (to GND) junction
static const uint8_t PIN_PIPE_THERM  = 34;  // 10k (to 3V3) / thermistor (to GND) junction
static const uint8_t PIN_LEAK_SENSE  = 35;  // soil moisture sensor SIG/AO (sensor on 3V3), lying flat on the floor
static const uint8_t PIN_VALVE_SW    = 32;  // micro switch: the valve arm presses it when the valve is shut
static const uint8_t PIN_US_ECHO     = 33;  // HC-SR04 ECHO through 1k/2k divider (5V -> 3.3V)
static const uint8_t PIN_US_TRIG     = 25;  // HC-SR04 TRIG
// Joystick (operator override) uses the pins freed by the dropped ultrasonic / thermistor.
static const bool    HAS_ULTRASONIC = false;   // D33/D25 now belong to the joystick
static const bool    HAS_JOYSTICK   = true;
static const uint8_t PIN_JOY_X = 34, PIN_JOY_Y = 33, PIN_JOY_SW = 25;   // VRx, VRy (analog), SW (to GND)
static const uint8_t PIN_DHT         = 26;  // DHT11 data
static const uint8_t PIN_PIR         = 27;  // HC-SR501 OUT
static const uint8_t PIN_FAN_EN      = 14;  // L293D pin 1 (PWM)
static const uint8_t PIN_DOOR_SERVO  = 12;  // SG90 #2 signal: fire door. (GPIO12 must be LOW at boot; a servo input is fine)
static const uint8_t PIN_STROBE      = 13;  // 1k -> PN2222 base -> relay -> white LEDs
// Right header, top to bottom
static const uint8_t PIN_VALVE_SERVO = 23;  // SG90 signal
static const uint8_t PIN_SCL = 22, PIN_SDA = 21;                             // OLED
static const uint8_t PIN_BEAM_LED    = 19;  // smoke-beam GREEN LED via 100R (white/blue are too dim at 3.3 V)
static const uint8_t PIN_SR_DATA = 18, PIN_SR_CLK = 5, PIN_SR_LATCH = 17;   // 74HC595 DS / SH_CP / ST_CP
// Room LEDs, simple build: 3 red LEDs straight on D18 / D5 / TX2 (bathroom, mechanical, lounge),
// short legs joined, ONE shared resistor to GND. Only one LED is ever lit at a time (multiplexed
// at 500 Hz), so the shared resistor is safe and every LED looks equally bright. The corridor's
// alarm is shown by the strobe. Set false to use the 74HC595 + 8 LED build instead.
static const bool ROOM_LEDS_DIRECT = false;  // room LEDs dropped; D18/D5/TX2 now drive the RFID reader
static const uint8_t ROOM_LED_PINS[3] = {18, 5, 17};
static const uint8_t PIN_BUZZER      = 16;  // active buzzer +
// RC522 RFID reader (human approval: the manager taps a card). Uses pins freed by dropping the
// thermistor / ultrasonic / strobe / room-LED parts. RC522 runs on 3.3 V ONLY; its RST goes to 3.3 V.
static const bool    HAS_RFID = true;
static const uint8_t PIN_RFID_SCK = 18, PIN_RFID_MOSI = 17 /* TX2 */, PIN_RFID_SS = 5, PIN_RFID_MISO = 13;
static const uint8_t PIN_RGB_R = 15, PIN_RGB_G = 2, PIN_RGB_B = 4;           // agent status LED (R/B as wired on the build)

// ------------------------------------------------------------- tunables ---
static const bool     RGB_COMMON_ANODE = false;
static const uint16_t VALVE_OPEN_US    = 1000;   // handle along the pipe
static const uint16_t VALVE_CLOSED_US  = 1900;  // handle across the pipe (90 deg)
static const int      LEAK_ON_DELTA    = 400;   // ADC counts away from the dry baseline = wet
static const int      LEAK_OFF_DELTA   = 200;   // (either direction: resistive and capacitive sensors differ)
static const bool     HAS_VALVE_SWITCH = true;  // false -> reports vsw=-
static const bool     VALVE_SW_ACTIVE_HIGH = true;  // Grove micro switch: SIG HIGH when pressed.
                                                    // Bare switch to GND instead? set false (uses pull-up).
static const uint16_t DOOR_OPEN_US     = 1900;  // door held open (like a magnetic hold-open)
static const uint16_t DOOR_CLOSED_US   = 1000;   // door swung shut
// Servos run from the ESP32's VIN pin (USB 5V). Ramp slowly, one servo at a time, and go limp once
// in position, so the current spikes never pull USB down far enough to reset the board.
static const uint16_t SERVO_STEP_US    = 20;    // per 15 ms step: ~0.7 s for the 90-degree valve swing
static const uint16_t SERVO_STEP_MS    = 15;    // ~0.5 s for a full 90-degree move
static const uint16_t SERVO_HOLD_MS    = 300;   // keep pulsing this long after arriving, then go limp
static const bool     HAS_BUTTON       = false; // true once the button + 10k pull-up are wired (else GPIO36
                                                // floats and fakes presses / a self-test every boot)
static const bool     DISABLE_BROWNOUT = true;  // USB-powered servos dip the 3.3 V rail briefly
static const uint32_t LEAK_DRY_MS      = 3000;  // must read dry this long before "cleared"
static const float    SMOKE_ON_FRAC    = 0.55f; // beam below 55 % of clear baseline = smoke
static const float    SMOKE_OFF_FRAC   = 0.75f;
static const float    FAN_MIN_DUTY     = 0.62f;   // on ~5 V USB minus the L293D's ~1.8 V drop, less than this stalls the motor
static const uint16_t FAN_KICK_MS      = 250;     // full-power burst when starting from a stop (breaks static friction)
static const float    THERM_R_FIXED = 10000.0f, THERM_R25 = 10000.0f, THERM_BETA = 3950.0f;
static const uint32_t LINK_TIMEOUT_MS  = 3000;

// ------------------------------------------------------- PWM (LEDC) shim ---
static void pwmAttach(uint8_t pin, uint8_t ch, uint32_t freq, uint8_t bits) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)ch; ledcAttach(pin, freq, bits);
#else
  ledcSetup(ch, freq, bits); ledcAttachPin(pin, ch);
#endif
}
static void pwmWrite(uint8_t pin, uint8_t ch, uint32_t duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)ch; ledcWrite(pin, duty);
#else
  (void)pin; ledcWrite(ch, duty);
#endif
}
enum { CH_SERVO = 0, CH_FAN = 2, CH_DOOR = 4 };

// ---------------------------------------------------------------- state ---
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
DHT dht(PIN_DHT, DHT11);
bool oledOk = false;

// sensors
int leakRaw = 0, leakDry = 0;  bool leakWet = false; uint32_t leakDrySince = 0;
int beamDelta = 0, beamBase = 0; bool smoke = false; uint32_t smokeSince = 0;
float tempC = NAN, rhPct = NAN, pipeC = NAN, levelCm = NAN;
bool pir = false;
uint32_t btnSeq = 0;
int valveSw = -1;               // -1 not fitted, 1 pressed (valve physically shut), 0 not pressed

// actuators
bool valveOpen = true;          // what the valve is doing now
bool laptopWantsOpen = true;    // last request from the laptop
bool doorOpen = true;           // fire door: open (held) / shut
bool laptopWantsDoorOpen = true;
float fanLevel = 0;
bool strobeOn = false;
int buzzMode = 0;
uint8_t roomState[4] = {0, 0, 0, 0};
int agentState = 0;

char oledLines[6][22];
bool oledDirty = true, online = false;
uint32_t lastCmdMs = 0;

// ------------------------------------------------------------------ helpers ---
static int adcAvg(uint8_t pin, int n = 8) { long s = 0; for (int i = 0; i < n; i++) s += analogRead(pin); return s / n; }
static float clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

ServoCh servoValve = {PIN_VALVE_SERVO, CH_SERVO, VALVE_OPEN_US, VALVE_OPEN_US, 0, false};
ServoCh servoDoor  = {PIN_DOOR_SERVO,  CH_DOOR,  DOOR_OPEN_US,  DOOR_OPEN_US,  0, false};
static void servoPulse(ServoCh& sv, uint16_t us) { pwmWrite(sv.pin, sv.ch, (uint32_t)(us * 65535.0f / 20000.0f)); }
static void servoGoto(ServoCh& sv, uint16_t us) { if (sv.target != us || sv.limp) { sv.target = us; sv.limp = false; sv.arrived = 0; } }
static bool servoMoving(const ServoCh& sv) { return sv.cur != sv.target; }
static void servoStep(ServoCh& sv) {
  uint32_t now = millis();
  if (sv.limp) return;
  if (sv.cur != sv.target) {
    int d = (int)sv.target - (int)sv.cur;
    sv.cur += (abs(d) <= SERVO_STEP_US) ? d : (d > 0 ? SERVO_STEP_US : -(int)SERVO_STEP_US);
    servoPulse(sv, sv.cur);
    sv.arrived = now;
  } else if (now - sv.arrived > SERVO_HOLD_MS) {
    pwmWrite(sv.pin, sv.ch, 0);   // no pulses: servo goes limp and stops drawing current
    sv.limp = true;
  } else {
    servoPulse(sv, sv.cur);
  }
}
static void servoTask() {   // one servo at a time: the valve (safety) always goes first
  static uint32_t last = 0;
  if (millis() - last < SERVO_STEP_MS) return;
  last = millis();
  servoStep(servoValve);
  if (!servoMoving(servoValve)) servoStep(servoDoor);
}
static void servoWait(uint32_t ms) { uint32_t t = millis(); while (millis() - t < ms) { servoTask(); delay(2); } }

static void setValve(bool open) { valveOpen = open; servoGoto(servoValve, open ? VALVE_OPEN_US : VALVE_CLOSED_US); }
static void setDoor(bool open)  { doorOpen = open;  servoGoto(servoDoor,  open ? DOOR_OPEN_US  : DOOR_CLOSED_US); }
// The fan motor runs from VIN (USB 5V): ramp it (soft start) so its inrush never drops the USB link.
float fanApplied = 0;
static void setFan(float f) { fanLevel = clamp01(f); }
static void fanTask() {
  static uint32_t last = 0;
  if (millis() - last < 20) return;
  last = millis();
  float step = 0.02f;                                   // full speed in ~1 s
  if (fanApplied < fanLevel) fanApplied = min(fanLevel, fanApplied + step);
  else if (fanApplied > fanLevel) fanApplied = max(fanLevel, fanApplied - 4 * step);   // slowing down is safe
  static uint32_t kickUntil = 0; static bool wasStopped = true;
  if (fanApplied >= 0.05f && wasStopped) kickUntil = millis() + FAN_KICK_MS;
  wasStopped = fanApplied < 0.05f;
  float duty = fanApplied < 0.05f ? 0.0f : FAN_MIN_DUTY + fanApplied * (1.0f - FAN_MIN_DUTY);
  if (millis() < kickUntil) duty = 1.0f;
  pwmWrite(PIN_FAN_EN, CH_FAN, (uint32_t)(duty * 255));
}
Ticker roomMux;
static void roomMuxTick() {          // off: OK · blinking: warning · solid: alarm
  static uint8_t idx = 0;
  bool blink = (millis() / 300) % 2;
  for (uint8_t i = 0; i < 3; i++) digitalWrite(ROOM_LED_PINS[i], LOW);
  idx = (idx + 1) % 3;
  uint8_t st = roomState[idx];
  if (st == 2 || (st == 1 && blink)) digitalWrite(ROOM_LED_PINS[idx], HIGH);
}
static void writeRoomLeds() {
  if (ROOM_LEDS_DIRECT || HAS_RFID) return;   // Ticker drives them / pins belong to the RFID reader
  // Q0..Q7 = R1 green, R1 red, R2 green, R2 red, R3 green, R3 red, R4 green, R4 red
  bool blink = (millis() / 300) % 2;
  uint8_t bits = 0;
  for (int i = 0; i < 4; i++) {
    uint8_t s = roomState[i];
    bool g = (s == 0) || (s == 1 && blink);
    bool r = (s == 2) || (s == 1 && !blink);
    if (g) bits |= 1 << (i * 2);
    if (r) bits |= 1 << (i * 2 + 1);
  }
  digitalWrite(PIN_SR_LATCH, LOW);
  shiftOut(PIN_SR_DATA, PIN_SR_CLK, MSBFIRST, bits);
  digitalWrite(PIN_SR_LATCH, HIGH);
}
static void writeRgb() {
  uint32_t t = millis();
  bool r = false, g = false, b = false;
  switch (agentState) {
    case 1: r = b = (t / 250) % 2; break;  // thinking: purple blink
    case 2: r = g = true; break;           // waiting for a human: yellow
    case 3: g = true; break;               // done: green
    default: break;
  }
  if (RGB_COMMON_ANODE) { r = !r; g = !g; b = !b; }
  digitalWrite(PIN_RGB_R, r); digitalWrite(PIN_RGB_G, g); digitalWrite(PIN_RGB_B, b);
}
static void updateBuzzer() {
  uint32_t t = millis();
  bool localAlarm = leakWet || smoke;  // sound even with no laptop
  bool on = false;
  if (buzzMode == 2 || (!online && localAlarm)) on = (t % 500) < 250;
  else if (buzzMode == 1) on = (t % 2000) < 80;
  digitalWrite(PIN_BUZZER, on);
}

// ------------------------------------------------------------------ sensors ---
static int sampleLeak() { return adcAvg(PIN_LEAK_SENSE, 6); }
static int leakDelta() { return abs(leakRaw - leakDry); }
static int sampleBeam() {
  digitalWrite(PIN_BEAM_LED, HIGH); delayMicroseconds(1500);
  int on = adcAvg(PIN_BEAM_SENSE, 6);
  digitalWrite(PIN_BEAM_LED, LOW);  delayMicroseconds(1500);
  int off = adcAvg(PIN_BEAM_SENSE, 6);
  return abs(on - off);  // ambient light cancels out (abs: works with LDR modules wired either way)
}
static void calibrateBaselines() {
  long l = 0, b = 0;
  for (int i = 0; i < 16; i++) { l += sampleLeak(); b += sampleBeam(); delay(5); }
  leakDry = l / 16;
  beamBase = max(1L, b / 16);
}

static void readLeakAndReflex() {
  leakRaw = sampleLeak();
  uint32_t now = millis();
  if (!leakWet && leakDelta() > LEAK_ON_DELTA) {
    leakWet = true;
    setValve(false);             // <<< REFLEX: close now, no laptop or AI needed
    roomState[0] = 2;
  } else if (leakWet) {
    if (leakDelta() < LEAK_OFF_DELTA) {
      if (!leakDrySince) leakDrySince = now;
      if (now - leakDrySince > LEAK_DRY_MS) { leakWet = false; leakDrySince = 0; }
    } else {
      leakDrySince = 0;
    }
  }
  if (leakWet && valveOpen) setValve(false);  // interlock: never open onto a live leak
}
static const bool HAS_SMOKE_BEAM = false;  // back to true once the beam's short is fixed
static const bool HAS_PIPE_THERM = false;  // dropped from the build (pin floats)   // set true once the green LED + photoresistor are wired
static bool beamFitted() { return HAS_SMOKE_BEAM && beamBase >= 40; }
static void readSmoke() {
  beamDelta = sampleBeam();
  if (!beamFitted()) { smoke = false; smokeSince = 0; return; }   // not wired yet: never fake a fire
  float frac = (float)beamDelta / beamBase;
  uint32_t now = millis();
  if (!smoke) {
    if (frac < SMOKE_ON_FRAC) { if (!smokeSince) smokeSince = now; if (now - smokeSince > 300) smoke = true; }
    else smokeSince = 0;
  } else if (frac > SMOKE_OFF_FRAC) { smoke = false; smokeSince = 0; }
  if (smoke && doorOpen) setDoor(false);   // <<< REFLEX: fire door releases on smoke, no laptop needed
}
static void readValveSwitch() {
  if (!HAS_VALVE_SWITCH) { valveSw = -1; return; }
  bool level = digitalRead(PIN_VALVE_SW) == HIGH;
  valveSw = (level == VALVE_SW_ACTIVE_HIGH) ? 1 : 0;
}
static void readPipe() {
  if (!HAS_PIPE_THERM) { pipeC = NAN; return; }
  uint32_t mv = 0;
  for (int i = 0; i < 8; i++) mv += analogReadMilliVolts(PIN_PIPE_THERM);
  float v = mv / 8000.0f;
  if (v < 0.05f || v > 3.25f) { pipeC = NAN; return; }
  float r = THERM_R_FIXED * v / (3.3f - v);
  float c = 1.0f / (1.0f / 298.15f + logf(r / THERM_R25) / THERM_BETA) - 273.15f;
  pipeC = isnan(pipeC) ? c : pipeC * 0.7f + c * 0.3f;
}
int joyX = -1, joyY = -1; bool joySw = false;
static void readJoystick() {
  if (!HAS_JOYSTICK) return;
  joyX = analogRead(PIN_JOY_X);
  joyY = analogRead(PIN_JOY_Y);
  joySw = digitalRead(PIN_JOY_SW) == LOW;
}
static void readLevel() {
  if (!HAS_ULTRASONIC) { levelCm = NAN; return; }
  digitalWrite(PIN_US_TRIG, LOW); delayMicroseconds(2);
  digitalWrite(PIN_US_TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(PIN_US_TRIG, LOW);
  unsigned long us = pulseIn(PIN_US_ECHO, HIGH, 25000);
  levelCm = us ? us / 58.0f : NAN;
}
static void readDht() {
  float t = dht.readTemperature(), h = dht.readHumidity();
  if (!isnan(t)) tempC = t;
  if (!isnan(h)) rhPct = h;
}
bool btnStable = false, btnRawLast = false; uint32_t btnChange = 0;
static void readButton() {
  if (!HAS_BUTTON) return;
  bool raw = digitalRead(PIN_BUTTON) == LOW;
  if (raw != btnRawLast) { btnRawLast = raw; btnChange = millis(); }
  if (millis() - btnChange > 30 && raw != btnStable) { btnStable = raw; if (raw) btnSeq++; }
}

// --------------------------------------------------------------------- RFID ---
MFRC522 rfid(PIN_RFID_SS, MFRC522::UNUSED_PIN);   // RST tied to 3.3 V
bool rfidOk = false;
char lastUid[24] = ""; uint32_t lastUidMs = 0;
static void rfidInit() {
  rfid.PCD_Init();
  rfid.PCD_SetAntennaGain(rfid.RxGain_max);   // clone boards read far better at max gain
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  bool ok = !(v == 0x00 || v == 0xFF);
  if (ok && !rfidOk) Serial.printf("RFID ready chip=0x%02X\n", v);
  rfidOk = ok;
}
static void pollRfid() {
  static uint32_t lastInit = 0;
  if (!HAS_RFID) return;
  if (!rfidOk) { if (millis() - lastInit > 3000) { lastInit = millis(); rfidInit(); } return; }  // plugged in later? keep trying
  // Clone RC522s can go deaf after a while (motor/servo noise on the supply): re-initialise every 5 s
  // while no card is being read. Costs ~2 ms, invisible to the demo.
  if (millis() - lastInit > 5000) { lastInit = millis(); rfidInit(); }
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  char uid[24]; int n = 0;
  for (byte i = 0; i < rfid.uid.size && n < 21; i++) n += snprintf(uid + n, sizeof uid - n, "%02X", rfid.uid.uidByte[i]);
  rfid.PICC_HaltA(); rfid.PCD_StopCrypto1();
  if (!strcmp(uid, lastUid) && millis() - lastUidMs < 2500) return;   // card still on the reader
  strcpy(lastUid, uid); lastUidMs = millis();
  Serial.printf("C uid=%s\n", uid);
  digitalWrite(PIN_BUZZER, HIGH); delay(60); digitalWrite(PIN_BUZZER, LOW);   // instant "beep" on tap
}

// --------------------------------------------------------------------- OLED ---
static void setLine(int i, const char* s) { strncpy(oledLines[i], s, 21); oledLines[i][21] = 0; }
static void oledRender() {
  if (!oledOk) return;
  oled.clearDisplay();
  oled.fillRect(0, 0, 128, 10, SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_BLACK); oled.setCursor(1, 1); oled.print(oledLines[0]);
  oled.setTextColor(SSD1306_WHITE);
  for (int i = 1; i < 6; i++) { oled.setCursor(0, 12 + (i - 1) * 10); oled.print(oledLines[i]); }
  oled.display();
}
static void fmt(char* out, size_t n, float v, const char* unit) {
  if (isnan(v)) snprintf(out, n, "--%s", unit); else snprintf(out, n, "%.1f%s", v, unit);
}
static void showLocal() {
  char b[22], t[10], h[10], p[10];
  setLine(0, online ? "SITESTAR PROTECT" : "PROTECT  OFFLINE");
  snprintf(b, sizeof b, "leak %s valve %s", leakWet ? "WET" : "dry", valveOpen ? "OPEN" : "SHUT"); setLine(1, b);
  snprintf(b, sizeof b, "smoke %s door %s", smoke ? "YES" : "no", doorOpen ? "open" : "SHUT"); setLine(2, b);
  fmt(t, sizeof t, tempC, "C"); fmt(h, sizeof h, rhPct, "%");
  snprintf(b, sizeof b, "mech %s %s", t, h); setLine(3, b);
  fmt(p, sizeof p, pipeC, "C");
  snprintf(b, sizeof b, "pipe %s pir %d", p, pir ? 1 : 0); setLine(4, b);
  setLine(5, online ? "" : "waiting for laptop..");
  oledRender();
}

// --------------------------------------------------------------- self-test ---
static void selfTest() {
  Serial.println("TEST begin");
  for (int i = 0; i < 4; i++) roomState[i] = 2; writeRoomLeds(); delay(400);
  for (int i = 0; i < 4; i++) roomState[i] = 0; writeRoomLeds();
  setValve(false); servoWait(900); setValve(true); servoWait(900);
  setDoor(false); servoWait(900); setDoor(true); servoWait(900);
  setFan(1); servoWait(1); { uint32_t t0 = millis(); while (millis() - t0 < 1500) { fanTask(); delay(5); } } setFan(0);
  digitalWrite(PIN_STROBE, HIGH); digitalWrite(PIN_BUZZER, HIGH); delay(150);
  digitalWrite(PIN_BUZZER, LOW); delay(650); digitalWrite(PIN_STROBE, LOW);
  for (int s = 1; s <= 3; s++) { agentState = s; writeRgb(); delay(400); }
  agentState = 0; writeRgb();
  Serial.println("TEST done");
}

// ------------------------------------------------------------ serial input ---
char rx[256]; size_t rxLen = 0;

static void handleCommand(char* args) {
  char* save;
  for (char* tok = strtok_r(args, " ", &save); tok; tok = strtok_r(nullptr, " ", &save)) {
    char* eq = strchr(tok, '=');
    if (!eq) continue;
    *eq = 0;
    const char* k = tok; char* v = eq + 1;
    if (!strcmp(k, "valve")) laptopWantsOpen = atoi(v) == 1;
    else if (!strcmp(k, "fan")) setFan(atof(v));
    else if (!strcmp(k, "strobe")) { strobeOn = atoi(v) == 1; digitalWrite(PIN_STROBE, strobeOn); }
    else if (!strcmp(k, "buzz")) buzzMode = atoi(v);
    else if (!strcmp(k, "agent")) agentState = atoi(v);
    else if (!strcmp(k, "door")) laptopWantsDoorOpen = atoi(v) == 1;
    else if (!strcmp(k, "r")) {
      int i = 0;
      for (char* p = v; *p && i < 4; p++) if (*p >= '0' && *p <= '2') roomState[i++] = *p - '0';
    }
  }
  // Laptop may close any time; it may only OPEN when the probe is dry (interlock).
  if (!laptopWantsOpen && valveOpen) setValve(false);
  if (laptopWantsOpen && !valveOpen && !leakWet) setValve(true);
  // Same rule for the fire door: close any time, open only once the smoke has cleared.
  if (!laptopWantsDoorOpen && doorOpen) setDoor(false);
  if (laptopWantsDoorOpen && !doorOpen && !smoke) setDoor(true);
  lastCmdMs = millis();
  if (!online) { online = true; oledDirty = true; }
}
static void handleLines(char* text) {
  int i = 0; char* start = text;
  for (char* p = text;; p++) {
    if (*p == '|' || *p == 0) {
      bool end = (*p == 0); *p = 0;
      if (i < 6) setLine(i++, start);
      if (end) break;
      start = p + 1;
    }
  }
  while (i < 6) setLine(i++, "");
  oledDirty = true;
}
static void handleLine(char* line) {
  if (line[0] == 'A' && line[1] == ' ') handleCommand(line + 2);
  else if (line[0] == 'L' && line[1] == ' ') handleLines(line + 2);
  else if (!strcmp(line, "TEST")) selfTest();
  else if (!strcmp(line, "RECAL")) { calibrateBaselines(); Serial.println("RECAL ok"); }
  else if (!strcmp(line, "PING")) Serial.println("PONG");
}
static void pollSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') { rx[rxLen] = 0; if (rxLen) handleLine(rx); rxLen = 0; }
    else if (rxLen < sizeof(rx) - 1) rx[rxLen++] = c;
    else rxLen = 0;
  }
}
static void printNum(const char* key, float v) {
  if (isnan(v)) Serial.printf(" %s=-", key); else Serial.printf(" %s=%.1f", key, v);
}
static void sendInputs() {
  Serial.printf("I leak=%d wet=%d beam=%d base=%d smoke=%d", leakRaw, leakWet ? 1 : 0, beamDelta, beamBase, smoke ? 1 : 0);
  printNum("t", tempC); printNum("rh", rhPct); printNum("pipe", pipeC);
  Serial.printf(" pir=%d", pir ? 1 : 0);
  printNum("lvl", levelCm);
  Serial.printf(" valve=%d", valveOpen ? 1 : 0);
  if (valveSw < 0) Serial.print(" vsw=-"); else Serial.printf(" vsw=%d", valveSw);
  Serial.printf(" door=%d", doorOpen ? 1 : 0);
  if (HAS_JOYSTICK) Serial.printf(" jx=%d jy=%d jsw=%d", joyX, joyY, joySw ? 1 : 0);
  Serial.printf(" bseq=%lu up=%lu\n", (unsigned long)btnSeq, (unsigned long)(millis() / 1000));
}

// -------------------------------------------------------------------- setup ---
void setup() {
#if __has_include("soc/rtc_cntl_reg.h")
  if (DISABLE_BROWNOUT) WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
#endif
  Serial.begin(115200);
  pinMode(PIN_VALVE_SW, VALVE_SW_ACTIVE_HIGH ? INPUT : INPUT_PULLUP);
  pinMode(PIN_BEAM_LED, OUTPUT);   digitalWrite(PIN_BEAM_LED, LOW);
  pinMode(PIN_PIR, INPUT);
  if (HAS_ULTRASONIC) { pinMode(PIN_US_TRIG, OUTPUT); digitalWrite(PIN_US_TRIG, LOW); pinMode(PIN_US_ECHO, INPUT); }
  if (HAS_JOYSTICK) pinMode(PIN_JOY_SW, INPUT_PULLUP);
  pinMode(PIN_BUTTON, INPUT);
  pinMode(PIN_STROBE, OUTPUT);     digitalWrite(PIN_STROBE, LOW);
  pinMode(PIN_BUZZER, OUTPUT);     digitalWrite(PIN_BUZZER, LOW);
  if (!HAS_RFID) { pinMode(PIN_SR_DATA, OUTPUT); pinMode(PIN_SR_CLK, OUTPUT); pinMode(PIN_SR_LATCH, OUTPUT); }
  if (ROOM_LEDS_DIRECT) {
    for (uint8_t i = 0; i < 3; i++) { pinMode(ROOM_LED_PINS[i], OUTPUT); digitalWrite(ROOM_LED_PINS[i], LOW); }
    roomMux.attach_ms(2, roomMuxTick);
  }
  pinMode(PIN_RGB_R, OUTPUT); pinMode(PIN_RGB_G, OUTPUT); pinMode(PIN_RGB_B, OUTPUT);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);   // full 0-3.3 V range on every analog pin

  pwmAttach(PIN_VALVE_SERVO, CH_SERVO, 50, 16);
  pwmAttach(PIN_FAN_EN, CH_FAN, 5000, 8);   // 5 kHz: the L293D is too slow for 20 kHz (speeds blur together)
  pwmAttach(PIN_DOOR_SERVO, CH_DOOR, 50, 16);
  setValve(true); setDoor(true); setFan(0);
  writeRoomLeds(); writeRgb();

  Wire.begin(PIN_SDA, PIN_SCL); Wire.setClock(400000);
  oledOk = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C) || oled.begin(SSD1306_SWITCHCAPVCC, 0x3D);
  dht.begin();

  // Leak sensor must be DRY and the beam CLEAR at power-up: these become the baselines.
  calibrateBaselines();
  if (HAS_RFID) { SPI.begin(PIN_RFID_SCK, PIN_RFID_MISO, PIN_RFID_MOSI, PIN_RFID_SS); rfidInit(); }
  Serial.printf("HELLO sitestar-protect v2 oled=%d dry=%d beam=%d\n", oledOk ? 1 : 0, leakDry, beamBase);
  if (HAS_BUTTON && digitalRead(PIN_BUTTON) == LOW) selfTest();
}

// --------------------------------------------------------------------- loop ---
void loop() {
  static uint32_t tFast = 0, tMed = 0, tSlow = 0, tDht = 0, tRfid = 0;
  if (millis() - tRfid >= 80) { tRfid = millis(); pollRfid(); }
  uint32_t now = millis();
  pollSerial();
  servoTask();
  fanTask();
  updateBuzzer();
  writeRgb();

  if (now - tFast >= 50) {       // 20 Hz: leak reflex, smoke, button, room LEDs
    tFast = now;
    readLeakAndReflex();
    readSmoke();
    readButton();
    readValveSwitch();
    readJoystick();
    pir = digitalRead(PIN_PIR) == HIGH;
    writeRoomLeds();
  }
  if (now - tMed >= 200) {       // 5 Hz: report, watchdog, OLED
    tMed = now;
    sendInputs();
    if (online && now - lastCmdMs > LINK_TIMEOUT_MS) {
      online = false; buzzMode = 0; agentState = 0; setFan(0);
      digitalWrite(PIN_STROBE, smoke ? HIGH : LOW);
      for (int i = 0; i < 4; i++) roomState[i] = 0;
      // the fire door stays shut until the laptop reopens it (like a real fire-door reset)
    }
    if (!online) {               // standalone: local alarms still work
      roomState[0] = leakWet ? 2 : 0;
      roomState[2] = smoke ? 2 : 0;
      digitalWrite(PIN_STROBE, smoke ? HIGH : LOW);
      showLocal();
    } else if (oledDirty) { oledRender(); oledDirty = false; }
  }
  if (now - tSlow >= 500) { tSlow = now; readPipe(); readLevel(); }
  if (now - tDht >= 2000) { tDht = now; readDht(); }
}

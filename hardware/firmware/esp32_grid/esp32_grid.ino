/*
 * PlotStar - Live Digital Twin: ESP32 miniature grid
 * ---------------------------------------------------
 * Board : ESP32 DevKit (ESP32-WROOM-32, 30 or 38 pin). Arduino-ESP32 core 2.x or 3.x.
 * Libs  : Adafruit SSD1306, Adafruit GFX (Library Manager).
 *
 * The ESP32 is a thin I/O device. The laptop (python -m plotstar_twin) holds all
 * state and decisions; this board drives the model grid and reports the knobs.
 *
 * Laptop -> ESP32 (newline terminated, 115200 baud):
 *   S h=13.50 wind=0.42 solar=0.80 gas=0.30 co2=412 diesel=0 alarm=0
 *   L line0|line1|line2|line3|line4|line5        (OLED text, 21 chars per line)
 *   TEST   run the hardware self-test
 *   ZERO   current clock-hand position becomes midnight
 *   PING   replies PONG
 * ESP32 -> laptop (every 100 ms):
 *   I flex=2 jx=0 jy=1 key=B kseq=4 bseq=1 temp=33.1 up=12345
 *     flex  0..3   potentiometer zone (0, 0.25, 0.5, 1 % flexibility)
 *     jx    -1/0/1 joystick X held left/centre/right (cooling: left=water, right=air)
 *     jy    -1/0/1 joystick Y held down/centre/up    (carbon price down/up)
 *     key   last keypad key A/B/C/D, kseq increments on every press
 *     bseq  increments on every grid-emergency button press
 *     temp  thermistor deg C, or "-" if not connected
 *
 * If no S line arrives for 3 s the board goes OFFLINE: every actuator off,
 * OLED shows raw knob readings (useful for wiring checks without the laptop).
 * Hold the red emergency button while powering up (or send TEST) for self-test.
 */

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#if __has_include("esp_arduino_version.h")
#include "esp_arduino_version.h"
#endif
#ifndef ESP_ARDUINO_VERSION_MAJOR
#define ESP_ARDUINO_VERSION_MAJOR 2
#endif

// ---------------------------------------------------------------- pin map ---
// Outputs
static const uint8_t PIN_OLED_SDA   = 21;
static const uint8_t PIN_OLED_SCL   = 22;
static const uint8_t PIN_STEP[4]    = {16, 17, 18, 19};  // ULN2003 IN1..IN4
static const uint8_t PIN_SERVO      = 23;                // SG90 signal (carbon needle)
static const uint8_t PIN_TURBINE    = 25;                // L293D pin 1 (EN1,2) PWM
static const uint8_t PIN_SOLAR      = 26;                // 1k -> PN2222 #1 base (5 yellow LEDs)
static const uint8_t PIN_GAS        = 27;                // 3 red LEDs, 220R each
static const uint8_t PIN_RELAY      = 13;                // 1k -> PN2222 #2 base (relay coil)
static const uint8_t PIN_BUZZER     = 33;                // active buzzer +
static const uint8_t PIN_STATUS_LED = 2;                 // on-board LED (heartbeat)
// Inputs
static const uint8_t PIN_BUTTON     = 15;                // emergency button to GND
static const uint8_t PIN_POT        = 34;                // potentiometer wiper (3V3 supply!)
static const uint8_t PIN_THERM      = 35;                // 10k/thermistor divider node
static const uint8_t PIN_JOY_Y      = 36;                // VP: joystick VRy (3V3 supply!)
static const uint8_t PIN_JOY_X      = 39;                // VN: joystick VRx
static const uint8_t PIN_KEY_ROW[4] = {4, 5, 14, 12};    // keypad pins 1..4 (rows 1..4)
static const uint8_t PIN_KEY_COL4   = 32;                // keypad pin 8 (column 4: A B C D)

// ------------------------------------------------------------- tunables ---
static const bool     SERVO_REVERSE   = false;   // flip if the needle moves the wrong way
static const uint16_t SERVO_MIN_US    = 600;     // needle at 0 gCO2/kWh
static const uint16_t SERVO_MAX_US    = 2300;    // needle at CO2_FULL_SCALE
static const float    CO2_FULL_SCALE  = 700.0f;  // gCO2/kWh at full deflection
static const float    SERVO_SLEW_US_S = 1200.0f; // gentle moves = less current from the 9V
static const bool     JOY_Y_INVERT    = true;    // most modules read LOW when pushed up
static const bool     JOY_X_INVERT    = false;
static const int      JOY_DEADBAND    = 700;     // ADC counts from centre
static const float    TURBINE_MIN_DUTY = 0.38f;  // below this the motor stalls
static const int32_t  STEPS_PER_REV   = 4076;    // 28BYJ-48 half-step (63.68:1 gearbox)
static const uint32_t STEP_INTERVAL_US = 1300;   // ~5 s per revolution max speed
static const float    THERM_R_FIXED   = 10000.0f;
static const float    THERM_R25       = 10000.0f;
static const float    THERM_BETA      = 3950.0f;
static const uint32_t LINK_TIMEOUT_MS = 3000;

// ------------------------------------------------------- PWM (LEDC) shim ---
// Core 3.x attaches by pin; core 2.x needs explicit channels.
static void pwmAttach(uint8_t pin, uint8_t ch, uint32_t freq, uint8_t bits) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)ch;
  ledcAttach(pin, freq, bits);
#else
  ledcSetup(ch, freq, bits);
  ledcAttachPin(pin, ch);
#endif
}
static void pwmWrite(uint8_t pin, uint8_t ch, uint32_t duty) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  (void)ch;
  ledcWrite(pin, duty);
#else
  (void)pin;
  ledcWrite(ch, duty);
#endif
}
enum { CH_SERVO = 0, CH_TURBINE = 2, CH_SOLAR = 4, CH_GAS = 5 };

// ---------------------------------------------------------------- state ---
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
bool oledOk = false;

struct Target {
  float hour = 0, wind = 0, solar = 0, gas = 0, co2 = 0;
  bool diesel = false, alarm = false;
} tgt;

char oledLines[6][22];
bool oledDirty = true;
uint32_t lastStateMs = 0;
bool online = false;

// inputs
int potZone = 0;
int joyCx = 2048, joyCy = 2048;
char lastKey = '-';
uint32_t keySeq = 0, btnSeq = 0;
float tempC = NAN;
int jxState = 0, jyState = 0;

// --------------------------------------------------------------- helpers ---
static float clamp01(float v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

static int readAdcAvg(uint8_t pin, int n = 8) {
  long s = 0;
  for (int i = 0; i < n; i++) s += analogRead(pin);
  return (int)(s / n);
}

// ------------------------------------------------------------------ servo ---
float servoUs = (SERVO_MIN_US + SERVO_MAX_US) / 2.0f;
float servoTargetUs = servoUs;
uint32_t servoSettledMs = 0;
bool servoPulsing = false;

static void servoWriteUs(float us) {
  uint32_t duty = (uint32_t)(us * 65535.0f / 20000.0f);  // 50 Hz, 16-bit
  pwmWrite(PIN_SERVO, CH_SERVO, duty);
  servoPulsing = true;
}
static void servoSetCo2(float g) {
  float f = clamp01(g / CO2_FULL_SCALE);
  if (SERVO_REVERSE) f = 1.0f - f;
  servoTargetUs = SERVO_MIN_US + f * (SERVO_MAX_US - SERVO_MIN_US);
}
static void servoUpdate(float dt) {
  float diff = servoTargetUs - servoUs;
  if (fabsf(diff) > 2.0f) {
    float step = SERVO_SLEW_US_S * dt;
    servoUs += (fabsf(diff) < step) ? diff : (diff > 0 ? step : -step);
    servoWriteUs(servoUs);
    servoSettledMs = millis();
  } else if (servoPulsing && millis() - servoSettledMs > 600) {
    pwmWrite(PIN_SERVO, CH_SERVO, 0);  // stop pulses: no jitter, less battery
    servoPulsing = false;
  }
}

// ---------------------------------------------------------------- stepper ---
static const uint8_t HALF_STEP[8][4] = {
  {1,0,0,0},{1,1,0,0},{0,1,0,0},{0,1,1,0},{0,0,1,0},{0,0,1,1},{0,0,0,1},{1,0,0,1}};
int32_t stepPos = 0, stepTarget = 0;
uint32_t lastStepUs = 0, lastStepMoveMs = 0;
bool coilsOn = false;

static void stepperCoils(int phase) {
  for (int i = 0; i < 4; i++) digitalWrite(PIN_STEP[i], HALF_STEP[phase][i]);
  coilsOn = true;
}
static void stepperRelease() {
  for (int i = 0; i < 4; i++) digitalWrite(PIN_STEP[i], LOW);
  coilsOn = false;
}
static void stepperSetHour(float h) {
  int32_t desired = (int32_t)(fmodf(h, 24.0f) / 24.0f * STEPS_PER_REV);
  int32_t curMod = ((stepPos % STEPS_PER_REV) + STEPS_PER_REV) % STEPS_PER_REV;
  int32_t delta = desired - curMod;
  if (delta < -STEPS_PER_REV / 2) delta += STEPS_PER_REV;  // midnight wrap: keep going forward
  if (delta >  STEPS_PER_REV / 2) delta -= STEPS_PER_REV;
  stepTarget = stepPos + delta;
}
static void stepperUpdate() {
  if (stepPos == stepTarget) {
    if (coilsOn && millis() - lastStepMoveMs > 300) stepperRelease();  // save the battery
    return;
  }
  uint32_t now = micros();
  if (now - lastStepUs < STEP_INTERVAL_US) return;
  lastStepUs = now;
  stepPos += (stepTarget > stepPos) ? 1 : -1;
  stepperCoils(((stepPos % 8) + 8) % 8);
  lastStepMoveMs = millis();
}

// ----------------------------------------------------------- grid outputs ---
static void setTurbine(float f) {
  f = clamp01(f);
  float duty = (f < 0.05f) ? 0.0f : TURBINE_MIN_DUTY + f * (1.0f - TURBINE_MIN_DUTY);
  pwmWrite(PIN_TURBINE, CH_TURBINE, (uint32_t)(duty * 255));
}
static void setSolar(float f) { pwmWrite(PIN_SOLAR, CH_SOLAR, (uint32_t)(clamp01(f) * 255)); }
static void setGas(float f)   { pwmWrite(PIN_GAS, CH_GAS, (uint32_t)(clamp01(f) * 255)); }
static void setRelay(bool on) { digitalWrite(PIN_RELAY, on ? HIGH : LOW); }

static void allOff() {
  setTurbine(0); setSolar(0); setGas(0); setRelay(false);
  digitalWrite(PIN_BUZZER, LOW);
}

// ----------------------------------------------------------------- buzzer ---
uint32_t chirpUntil = 0;
static void chirp(uint16_t ms) { chirpUntil = millis() + ms; }
static void buzzerUpdate() {
  uint32_t now = millis();
  bool on = now < chirpUntil;
  if (online && tgt.alarm) on = on || ((now % 700) < 140);  // beep-beep while diesel runs
  digitalWrite(PIN_BUZZER, on ? HIGH : LOW);
}

// ----------------------------------------------------------------- inputs ---
static void readPot() {
  int v = readAdcAvg(PIN_POT);
  // 4 zones with hysteresis so the level doesn't flicker on a boundary
  static const int edges[3] = {1024, 2048, 3072};
  const int H = 90;
  int z = potZone;
  while (z < 3 && v > edges[z] + H) z++;
  while (z > 0 && v < edges[z - 1] - H) z--;
  potZone = z;
}
static void readJoystick() {
  int x = readAdcAvg(PIN_JOY_X, 4) - joyCx;
  int y = readAdcAvg(PIN_JOY_Y, 4) - joyCy;
  if (JOY_X_INVERT) x = -x;
  if (JOY_Y_INVERT) y = -y;
  jxState = (x > JOY_DEADBAND) ? 1 : (x < -JOY_DEADBAND ? -1 : 0);
  jyState = (y > JOY_DEADBAND) ? 1 : (y < -JOY_DEADBAND ? -1 : 0);
}
static void readThermistor() {
  uint32_t mv = 0;
  for (int i = 0; i < 8; i++) mv += analogReadMilliVolts(PIN_THERM);
  float v = mv / 8000.0f;
  if (v < 0.05f || v > 3.25f) { tempC = NAN; return; }  // open or shorted
  // 3V3 -> R_FIXED -> node -> thermistor -> GND
  float r = THERM_R_FIXED * v / (3.3f - v);
  float invT = 1.0f / 298.15f + logf(r / THERM_R25) / THERM_BETA;
  float c = 1.0f / invT - 273.15f;
  tempC = isnan(tempC) ? c : tempC * 0.8f + c * 0.2f;
}

const char KEYS_COL4[4] = {'A', 'B', 'C', 'D'};
uint8_t keyStable = 0xFF, keyCandidate = 0xFF, keyCount = 0;
static void scanKeypad() {
  uint8_t found = 0xFF;
  for (int r = 0; r < 4; r++) {
    pinMode(PIN_KEY_ROW[r], OUTPUT);
    digitalWrite(PIN_KEY_ROW[r], LOW);
    delayMicroseconds(8);
    bool pressed = digitalRead(PIN_KEY_COL4) == LOW;
    pinMode(PIN_KEY_ROW[r], INPUT);  // high-Z when idle
    if (pressed) { found = r; break; }
  }
  if (found == keyCandidate) { if (keyCount < 3) keyCount++; }
  else { keyCandidate = found; keyCount = 0; }
  if (keyCount == 3 && keyCandidate != keyStable) {
    keyStable = keyCandidate;
    if (keyStable != 0xFF) { lastKey = KEYS_COL4[keyStable]; keySeq++; chirp(40); }
  }
}

bool btnStable = false, btnLastRaw = false;
uint32_t btnChangeMs = 0;
static void readButton() {
  bool raw = digitalRead(PIN_BUTTON) == LOW;
  if (raw != btnLastRaw) { btnLastRaw = raw; btnChangeMs = millis(); }
  if (millis() - btnChangeMs > 30 && raw != btnStable) {
    btnStable = raw;
    if (btnStable) { btnSeq++; chirp(80); }
  }
}

// ------------------------------------------------------------------- OLED ---
static void oledRender() {
  if (!oledOk) return;
  oled.clearDisplay();
  oled.fillRect(0, 0, 128, 10, SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setTextColor(SSD1306_BLACK);
  oled.setCursor(1, 1);
  oled.print(oledLines[0]);
  oled.setTextColor(SSD1306_WHITE);
  for (int i = 1; i < 6; i++) {
    oled.setCursor(0, 12 + (i - 1) * 10);
    oled.print(oledLines[i]);
  }
  oled.display();
}
static void setLine(int i, const char* s) {
  strncpy(oledLines[i], s, 21);
  oledLines[i][21] = 0;
}
static void showOffline() {
  char b[22];
  setLine(0, "PLOTSTAR  OFFLINE");
  setLine(1, "waiting for laptop..");
  snprintf(b, sizeof b, "flex zone %d", potZone);            setLine(2, b);
  snprintf(b, sizeof b, "joy x%+d y%+d", jxState, jyState);   setLine(3, b);
  snprintf(b, sizeof b, "key %c#%lu btn#%lu", lastKey, (unsigned long)keySeq, (unsigned long)btnSeq);
  setLine(4, b);
  if (isnan(tempC)) setLine(5, "therm: not connected");
  else { snprintf(b, sizeof b, "therm %.1f C", tempC); setLine(5, b); }
  oledRender();
}

// ------------------------------------------------------------ self-test ---
static void selfTest() {
  Serial.println("TEST begin");
  setLine(0, "SELF TEST"); for (int i = 1; i < 6; i++) setLine(i, "");
  setLine(1, "needle sweep"); oledRender();
  for (int us = SERVO_MIN_US; us <= SERVO_MAX_US; us += 20) { servoWriteUs(us); delay(10); }
  for (int us = SERVO_MAX_US; us >= SERVO_MIN_US; us -= 20) { servoWriteUs(us); delay(10); }
  pwmWrite(PIN_SERVO, CH_SERVO, 0); servoUs = SERVO_MIN_US;
  setLine(2, "solar LEDs"); oledRender();
  for (int i = 0; i <= 255; i += 5) { pwmWrite(PIN_SOLAR, CH_SOLAR, i); delay(8); } setSolar(0);
  setLine(3, "gas LEDs"); oledRender();
  for (int i = 0; i <= 255; i += 5) { pwmWrite(PIN_GAS, CH_GAS, i); delay(8); } setGas(0);
  setLine(4, "turbine + relay"); oledRender();
  setTurbine(1); setRelay(true); digitalWrite(PIN_BUZZER, HIGH); delay(150);
  digitalWrite(PIN_BUZZER, LOW); delay(1350); setTurbine(0); setRelay(false);
  setLine(5, "clock: 1/4 turn"); oledRender();
  int32_t start = stepPos;
  stepTarget = stepPos + STEPS_PER_REV / 4;
  while (stepPos != stepTarget) stepperUpdate();
  stepTarget = start;
  while (stepPos != stepTarget) stepperUpdate();
  stepperRelease();
  Serial.println("TEST done");
}

// ---------------------------------------------------------- serial input ---
char rx[256];
size_t rxLen = 0;

static void handleState(char* args) {
  char* save;
  for (char* tok = strtok_r(args, " ", &save); tok; tok = strtok_r(nullptr, " ", &save)) {
    char* eq = strchr(tok, '=');
    if (!eq) continue;
    *eq = 0;
    const char* k = tok;
    float v = atof(eq + 1);
    if      (!strcmp(k, "h"))      tgt.hour = v;
    else if (!strcmp(k, "wind"))   tgt.wind = v;
    else if (!strcmp(k, "solar"))  tgt.solar = v;
    else if (!strcmp(k, "gas"))    tgt.gas = v;
    else if (!strcmp(k, "co2"))    tgt.co2 = v;
    else if (!strcmp(k, "diesel")) tgt.diesel = v > 0.5f;
    else if (!strcmp(k, "alarm"))  tgt.alarm = v > 0.5f;
  }
  lastStateMs = millis();
  if (!online) { online = true; oledDirty = true; }
  setTurbine(tgt.wind);
  setSolar(tgt.solar);
  setGas(tgt.gas);
  setRelay(tgt.diesel);
  servoSetCo2(tgt.co2);
  stepperSetHour(tgt.hour);
}
static void handleLines(char* text) {
  int i = 0;
  char* start = text;
  for (char* p = text; ; p++) {
    if (*p == '|' || *p == 0) {
      bool end = (*p == 0);
      *p = 0;
      if (i < 6) setLine(i++, start);
      if (end) break;
      start = p + 1;
    }
  }
  while (i < 6) setLine(i++, "");
  oledDirty = true;
}
static void handleLine(char* line) {
  if (line[0] == 'S' && line[1] == ' ') handleState(line + 2);
  else if (line[0] == 'L' && line[1] == ' ') handleLines(line + 2);
  else if (!strcmp(line, "TEST")) selfTest();
  else if (!strcmp(line, "ZERO")) { stepPos = stepTarget = 0; Serial.println("ZERO ok"); }
  else if (!strcmp(line, "PING")) Serial.println("PONG");
}
static void pollSerial() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') { rx[rxLen] = 0; if (rxLen) handleLine(rx); rxLen = 0; }
    else if (rxLen < sizeof(rx) - 1) rx[rxLen++] = c;
    else rxLen = 0;  // overflow: drop the line
  }
}

static void sendInputs() {
  char t[12];
  if (isnan(tempC)) strcpy(t, "-"); else snprintf(t, sizeof t, "%.1f", tempC);
  Serial.printf("I flex=%d jx=%d jy=%d key=%c kseq=%lu bseq=%lu temp=%s up=%lu\n",
                potZone, jxState, jyState, lastKey, (unsigned long)keySeq,
                (unsigned long)btnSeq, t, (unsigned long)(millis() / 1000));
}

// ------------------------------------------------------------------ setup ---
void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 4; i++) { pinMode(PIN_STEP[i], OUTPUT); digitalWrite(PIN_STEP[i], LOW); }
  pinMode(PIN_RELAY, OUTPUT);  digitalWrite(PIN_RELAY, LOW);
  pinMode(PIN_BUZZER, OUTPUT); digitalWrite(PIN_BUZZER, LOW);
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_BUTTON, INPUT_PULLUP);
  pinMode(PIN_KEY_COL4, INPUT_PULLUP);
  for (int i = 0; i < 4; i++) pinMode(PIN_KEY_ROW[i], INPUT);

  analogReadResolution(12);
  analogSetPinAttenuation(PIN_POT, ADC_11db);
  analogSetPinAttenuation(PIN_THERM, ADC_11db);
  analogSetPinAttenuation(PIN_JOY_X, ADC_11db);
  analogSetPinAttenuation(PIN_JOY_Y, ADC_11db);

  pwmAttach(PIN_SERVO, CH_SERVO, 50, 16);
  pwmAttach(PIN_TURBINE, CH_TURBINE, 20000, 8);  // 20 kHz: no motor whine
  pwmAttach(PIN_SOLAR, CH_SOLAR, 5000, 8);
  pwmAttach(PIN_GAS, CH_GAS, 5000, 8);
  allOff();
  pwmWrite(PIN_SERVO, CH_SERVO, 0);

  Wire.begin(PIN_OLED_SDA, PIN_OLED_SCL);
  Wire.setClock(400000);
  oledOk = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C) || oled.begin(SSD1306_SWITCHCAPVCC, 0x3D);

  // Joystick must be untouched at boot: this is its centre.
  delay(50);
  joyCx = readAdcAvg(PIN_JOY_X, 32);
  joyCy = readAdcAvg(PIN_JOY_Y, 32);

  Serial.printf("HELLO plotstar-grid v1 oled=%d core=%d\n", oledOk ? 1 : 0, ESP_ARDUINO_VERSION_MAJOR);
  if (digitalRead(PIN_BUTTON) == LOW) selfTest();
  showOffline();
}

// ------------------------------------------------------------------- loop ---
void loop() {
  static uint32_t lastFast = 0, lastSlow = 0, lastSend = 0, lastLoopUs = micros();
  uint32_t nowMs = millis();
  uint32_t nowUs = micros();
  float dt = (nowUs - lastLoopUs) / 1e6f;
  lastLoopUs = nowUs;

  pollSerial();
  stepperUpdate();
  servoUpdate(dt);
  buzzerUpdate();

  if (nowMs - lastFast >= 20) {  // 50 Hz: buttons and keypad
    lastFast = nowMs;
    readButton();
    scanKeypad();
  }
  if (nowMs - lastSlow >= 100) {  // 10 Hz: analog inputs, link watchdog, OLED
    lastSlow = nowMs;
    readPot();
    readJoystick();
    readThermistor();
    if (online && nowMs - lastStateMs > LINK_TIMEOUT_MS) {
      online = false;
      allOff();
      tgt = Target();
    }
    if (!online) showOffline();
    else if (oledDirty) { oledRender(); oledDirty = false; }
    digitalWrite(PIN_STATUS_LED, online ? ((nowMs / 500) % 2) : ((nowMs / 100) % 2));
  }
  if (nowMs - lastSend >= 100) {
    lastSend = nowMs;
    sendInputs();
  }
}

/*
 * SiteStar PROTECT - lobby panel (board 2) on an Arduino UNO R4 WiFi
 * ------------------------------------------------------------------
 * Board : Arduino UNO R4 WiFi (arduino:renesas_uno:unor4wifi). Grove Base Shield can stay on top.
 * Libs  : MFRC522 (miguelbalboa). The LED matrix library ships with the R4 core.
 *
 * What it does on the model's front door:
 *   - RC522 RFID reader: the plumber the AI dispatched taps their fob to check in; the building
 *     manager taps their card to approve whatever the AI is waiting on. Unknown cards are refused.
 *   - The R4's built-in 12x8 LED matrix shows the building's state: a water drop and "VALVE SHUT
 *     SAVED 24 L" during a leak, a flame during a fire alarm, a tick / cross when a badge is tapped.
 * The ESP32 (board 1) still owns every safety reflex. This panel only reports taps and displays.
 *
 * RC522 wiring (through the Base Shield's pass-through headers):
 *   SDA(SS) D10 · SCK D13 · MOSI D11 · MISO D12 · RST D9 · 3.3V -> 3.3V (NOT 5V) · GND -> GND · IRQ unused
 *
 * R4 -> laptop:  HELLO sitestar-lobby v1 rfid=1
 *                C uid=20111B5C              (one line per tap)
 *                I lobby up=93               (every 2 s, heartbeat)
 * laptop -> R4:  P icon=drop text=LEAK 2F BATH  VALVE SHUT
 *                (icons: idle drop fire check cross wait wrench; text A-Z 0-9 and . - $ ! : / % ?)
 *                PING
 */

#include <Arduino.h>
#include <SPI.h>
#include <MFRC522.h>
#include "Arduino_LED_Matrix.h"
#include "font_icons.h"

static const uint8_t PIN_RC522_SS = 10, PIN_RC522_RST = 9;
static const uint16_t SCROLL_MS = 70;       // per pixel column
static const uint16_t ICON_MS = 1600;       // icon shown between text passes
static const uint32_t LINK_TIMEOUT_MS = 6000;

MFRC522 rfid(PIN_RC522_SS, PIN_RC522_RST);
ArduinoLEDMatrix matrix;
uint8_t frame[8][12];
bool rfidOk = false;

int icon = ICON_IDLE;
char text[96] = "SITESTAR";
int textPx = 0;            // width of the text in pixels
int scrollX = 12;
bool showingIcon = true;
uint32_t phaseStart = 0, lastStep = 0, lastCmdMs = 0, flashUntil = 0;
char lastUid[24] = "";
uint32_t lastUidMs = 0;

// ------------------------------------------------------------------ drawing
static int glyphIndex(char c) {
  if (c >= 'a' && c <= 'z') c -= 32;
  const char* p = strchr(FONT_CHARS, c);
  return p ? (int)(p - FONT_CHARS) : 0;  // unknown -> space
}
static void clearFrame() { memset(frame, 0, sizeof frame); }
static void drawIcon(int i) { memcpy(frame, ICONS[i], sizeof frame); }
static void drawText(int x0) {
  clearFrame();
  int x = x0;
  for (const char* p = text; *p; p++, x += 4) {
    if (x > 11) break;
    if (x < -3) continue;
    const uint8_t* g = FONT[glyphIndex(*p)];
    for (int row = 0; row < 5; row++)
      for (int col = 0; col < 3; col++)
        if (g[row] & (4 >> col)) {
          int px = x + col;
          if (px >= 0 && px < 12) frame[row + 1][px] = 1;
        }
  }
}
static void startCycle() { showingIcon = true; phaseStart = millis(); drawIcon(icon); matrix.renderBitmap(frame, 8, 12); }

static void updateMatrix() {
  uint32_t now = millis();
  if (now < flashUntil) return;                         // tap feedback still showing
  if (showingIcon) {
    if (text[0] && now - phaseStart > ICON_MS) { showingIcon = false; scrollX = 12; lastStep = 0; }
    else { drawIcon(icon); matrix.renderBitmap(frame, 8, 12); return; }
  }
  if (now - lastStep < SCROLL_MS) return;
  lastStep = now;
  drawText(scrollX);
  matrix.renderBitmap(frame, 8, 12);
  if (--scrollX < -textPx) startCycle();
}

// --------------------------------------------------------------------- RFID
static void pollRfid() {
  if (!rfidOk || !rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  char uid[24]; int n = 0;
  for (byte i = 0; i < rfid.uid.size && n < 21; i++) n += snprintf(uid + n, sizeof uid - n, "%02X", rfid.uid.uidByte[i]);
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  uint32_t now = millis();
  if (!strcmp(uid, lastUid) && now - lastUidMs < 2500) return;   // same card held on the reader
  strcpy(lastUid, uid); lastUidMs = now;
  Serial.print("C uid="); Serial.println(uid);
  // Instant local feedback: full frame flash, then hourglass until the laptop answers.
  memset(frame, 1, sizeof frame); matrix.renderBitmap(frame, 8, 12);
  delay(120);
  icon = ICON_WAIT; text[0] = 0; startCycle();
}

// ------------------------------------------------------------------- serial
char rx[160]; size_t rxLen = 0;

static void handlePanel(char* args) {
  char* t = strstr(args, "text=");
  if (t) { strncpy(text, t + 5, sizeof text - 1); text[sizeof text - 1] = 0; *t = 0; }
  else text[0] = 0;
  char* ic = strstr(args, "icon=");
  if (ic) {
    char name[12] = ""; sscanf(ic + 5, "%11s", name);
    for (int i = 0; i < ICON_COUNT; i++) if (!strcmp(name, ICON_NAMES[i])) icon = i;
  }
  for (char* p = text; *p; p++) if (*p >= 'a' && *p <= 'z') *p -= 32;
  textPx = strlen(text) * 4;
  lastCmdMs = millis();
  flashUntil = 0;
  startCycle();
}
static void handleLine(char* line) {
  if (line[0] == 'P' && line[1] == ' ') handlePanel(line + 2);
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

// -------------------------------------------------------------------- setup
void setup() {
  Serial.begin(115200);
  matrix.begin();
  SPI.begin();
  rfid.PCD_Init();
  delay(10);
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  rfidOk = !(v == 0x00 || v == 0xFF);
  textPx = strlen(text) * 4;
  startCycle();
  Serial.print("HELLO sitestar-lobby v1 rfid="); Serial.print(rfidOk ? 1 : 0);
  Serial.print(" chip=0x"); Serial.println(v, HEX);
}

void loop() {
  static uint32_t tBeat = 0, tRfid = 0;
  uint32_t now = millis();
  pollSerial();
  if (now - tRfid >= 60) { tRfid = now; pollRfid(); }
  updateMatrix();
  if (now - tBeat >= 2000) {
    tBeat = now;
    Serial.print("I lobby up="); Serial.println(now / 1000);
    if (lastCmdMs && now - lastCmdMs > LINK_TIMEOUT_MS && icon != ICON_IDLE) {   // laptop gone: show idle
      icon = ICON_IDLE; strcpy(text, "OFFLINE"); textPx = strlen(text) * 4; lastCmdMs = 0; startCycle();
    }
  }
}

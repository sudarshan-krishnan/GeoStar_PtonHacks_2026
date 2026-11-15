/*
 * SiteStar - operator console (board 2) on an Arduino UNO R4 WiFi
 * -----------------------------------------------------------------
 * Board : Arduino UNO R4 WiFi (arduino:renesas_uno:unor4wifi). No extra libraries.
 *
 *   4x4 membrane keypad   A = start a grid event   B = end it
 *                         digits then # = cut depth (e.g. 4 0 #  -> pause 40% of AI jobs)
 *                         digits then A = start with that depth     * = clear
 *   4-digit 7-segment     live total watts of the data hall (flashes during a grid event);
 *   (5641AS, common       shows the digits while you type them
 *    cathode)
 *   built-in LED matrix   status icon + scrolling text (GRID EVENT, LEAK, ...)
 *
 * Wiring
 *   7-seg segments, direct:             A D2 · B D3 · C D4 · D D5 · E D6 · F D7 · G D8   (dot unused)
 *   7-seg digits, each through 220-470R: DIG1 A0 · DIG2 A1 · DIG3 A2 · DIG4 A3
 *   (4 resistors on the digit lines instead of 7 on the segments: each digit's slot lasts longer the
 *    more segments it lights, so every segment ends up equally bright.)
 *   keypad (ribbon at the bottom, pins left to right):
 *                                       1 D10 · 2 D11 · 3 D12 · 4 D13 (rows)
 *                                       5 D9  · 6 A4  · 7 A5  · 8 D0  (columns)
 *
 * R4 -> laptop:  HELLO sitestar-console v1 · K <key> (one per press) · I console up=<s> (every 2 s)
 * laptop -> R4:  W <watts|-> F <0|1> T <typed|-> S <fan %>      (every 0.5 s)
 *                P icon=<idle|drop|fire|check|cross|wait|wrench|bolt> text=<A-Z 0-9 . - $ ! : / % ?>
 *                PING
 */

#include <Arduino.h>
#include "Arduino_LED_Matrix.h"
#include "font_icons.h"

// ------------------------------------------------------------------ 7-segment
static const bool    SEG_COMMON_ANODE = false;           // 5641AS = common cathode
static const uint8_t SEG_PINS[7] = {2, 3, 4, 5, 6, 7, 8};    // a b c d e f g
static const uint8_t DIG_PINS[4] = {A0, A1, A2, A3};         // left -> right
//                          gfedcba
static const uint8_t DIGITS[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};
static const uint8_t SEG_DASH = 0x40, SEG_BLANK = 0x00, SEG_F = 0x71;
uint8_t segBuf[4] = {SEG_DASH, SEG_DASH, SEG_DASH, SEG_DASH};

static void segShowNumber(long v) {
  if (v < 0 || v > 9999) { for (int i = 0; i < 4; i++) segBuf[i] = SEG_DASH; return; }
  for (int i = 3; i >= 0; i--) { segBuf[i] = (v || i == 3) ? DIGITS[v % 10] : SEG_BLANK; v /= 10; }
}
static void segShowDashes() { for (int i = 0; i < 4; i++) segBuf[i] = SEG_DASH; }

static uint8_t litCount(uint8_t bits) { uint8_t n = 0; while (bits) { n += bits & 1; bits >>= 1; } return n; }
// Digit d is lit for SLOT_US x (segments lit): with the resistor on the digit line, segments share its
// current, so a longer slot for fuller digits evens out the brightness.
static const uint16_t SLOT_US = 350;
static uint32_t segSlotUs = SLOT_US;
static void segRefresh(bool visible) {          // one digit at a time (multiplexed)
  static uint8_t d = 0;
  digitalWrite(DIG_PINS[d], SEG_COMMON_ANODE ? LOW : HIGH);           // previous digit off
  d = (d + 1) % 4;
  uint8_t bits = visible ? segBuf[d] : 0;
  for (int s = 0; s < 7; s++) {
    bool on = bits & (1 << s);
    digitalWrite(SEG_PINS[s], SEG_COMMON_ANODE ? !on : on);
  }
  digitalWrite(DIG_PINS[d], SEG_COMMON_ANODE ? HIGH : LOW);           // this digit on
  segSlotUs = SLOT_US * max((uint8_t)1, litCount(bits));
}

// --------------------------------------------------------------------- keypad
static const uint8_t ROW_PINS[4] = {10, 11, 12, 13};
static const uint8_t COL_PINS[4] = {9, A4, A5, 0};
static const char KEYS[4][4] = {{'1', '2', '3', 'A'}, {'4', '5', '6', 'B'}, {'7', '8', '9', 'C'}, {'*', '0', '#', 'D'}};

static char scanKeypad() {
  for (int r = 0; r < 4; r++) {
    for (int i = 0; i < 4; i++) digitalWrite(ROW_PINS[i], i == r ? LOW : HIGH);
    delayMicroseconds(30);
    for (int c = 0; c < 4; c++) if (digitalRead(COL_PINS[c]) == LOW) return KEYS[r][c];
  }
  return 0;
}

// ----------------------------------------------------------------- LED matrix
extern long watts; extern bool flash;
int fanPct = 0;                                 // real fan duty from the laptop (S field)
uint32_t fanShowUntil = 0;                      // a fan-speed change is announced until this time
ArduinoLEDMatrix matrix;
uint8_t frame[8][12];
int icon = ICON_IDLE;
char text[96] = "SITESTAR";
int textPx = 32, scrollX = 12;
uint32_t lastStep = 0;

// Live power history: one sample a second, newest on the right (the "heart monitor").
long hist[12]; uint8_t histN = 0; uint32_t histAt = 0;
static void sampleHistory() {
  if (watts < 0 || millis() - histAt < 1000) return;
  histAt = millis();
  memmove(hist, hist + 1, sizeof(long) * 11);
  hist[11] = watts;
  if (histN < 12) histN++;
}

enum Phase { PH_BOOT, PH_ANIM, PH_FAN, PH_TEXT };
Phase phase = PH_BOOT;
uint32_t phaseStart = 0;
int8_t dropY[12]; uint8_t puddle = 0; uint32_t rainAt = 0;

static void clearF() { memset(frame, 0, sizeof frame); }
static void px(int x, int y) { if (x >= 0 && x < 12 && y >= 0 && y < 8) frame[y][x] = 1; }
static int glyphIndex(char c) {
  if (c >= 'a' && c <= 'z') c -= 32;
  const char* p = strchr(FONT_CHARS, c);
  return p ? (int)(p - FONT_CHARS) : 0;
}
static void drawText(int x0) {
  clearF();
  int x = x0;
  for (const char* p = text; *p; p++, x += 4) {
    if (x > 11) break;
    if (x < -3) continue;
    const uint8_t* g = FONT[glyphIndex(*p)];
    for (int row = 0; row < 5; row++)
      for (int col = 0; col < 3; col++)
        if (g[row] & (4 >> col)) px(x + col, row + 1);
  }
}

// --- animations --------------------------------------------------------------
static void drawGraph(uint32_t t) {              // bars = watts, auto-scaled so a cut is obvious
  clearF();
  if (!histN) { for (int x = 0; x < 12; x += 2) px(x, 7); return; }
  long lo = 100000, hi = 0;
  for (int i = 12 - histN; i < 12; i++) { lo = min(lo, hist[i]); hi = max(hi, hist[i]); }
  long span = max(4L, hi - lo);
  lo = max(0L, lo - span / 2);                  // headroom under the lowest bar
  span = max(4L, hi - lo);
  for (int i = 12 - histN; i < 12; i++) {
    int h = 1 + (int)((hist[i] - lo) * 7 / span);
    if (flash && i == 11 && (t / 200) % 2) continue;   // grid event: newest bar blinks
    for (int y = 0; y < h; y++) px(i, 7 - y);
  }
}
static void drawFan(uint32_t t) {                // spins at the real fan speed; bar on the right = duty
  static uint8_t step = 0; static uint32_t last = 0;
  static const int8_t D[8][2] = {{0, -1}, {1, -1}, {1, 0}, {1, 1}, {0, 1}, {-1, 1}, {-1, 0}, {-1, -1}};
  uint32_t period = fanPct <= 0 ? 0 : (uint32_t)map(constrain(fanPct, 1, 100), 1, 100, 420, 50);
  if (period && t - last >= period) { last = t; step = (step + 1) % 8; }
  clearF();
  const int cx = 5, cy = 4;
  px(cx, cy); px(cx - 1, cy); px(cx, cy - 1); px(cx - 1, cy - 1);           // hub
  for (int b = 0; b < 3; b++) {                                              // 3 blades
    int d = (step + b * 3) % 8, d2 = (d + 1) % 8;
    for (int r = 1; r <= 3; r++) px(cx + D[d][0] * r - (D[d][0] < 0), cy + D[d][1] * r - (D[d][1] < 0));
    px(cx + D[d][0] * 3 + D[d2][0] - (D[d][0] < 0), cy + D[d][1] * 3 + D[d2][1] - (D[d][1] < 0));   // curved tip
  }
  int bar = (fanPct * 8 + 50) / 100;
  for (int y = 0; y < bar; y++) px(11, 7 - y);
}
static void drawRain(uint32_t t) {               // leak: drops fall, a puddle rises
  if (t - rainAt > 90) {
    rainAt = t;
    for (int x = 0; x < 11; x++) {
      if (dropY[x] >= 0) { if (++dropY[x] > 7 - puddle) dropY[x] = -1; }
      else if (random(9) == 0) dropY[x] = 0;
    }
    if (puddle < 3 && random(18) == 0) puddle++;
  }
  clearF();
  for (int x = 0; x < 11; x++) if (dropY[x] >= 0) { px(x, dropY[x]); px(x, dropY[x] - 1); }
  for (int p = 0; p < puddle; p++) for (int x = 0; x < 12; x++) px(x, 7 - p);
}
static void drawFire(uint32_t t) {               // smoke/fire: flickering flames
  static uint8_t h[12]; static uint32_t at = 0;
  if (t - at > 70) {
    at = t;
    for (int x = 0; x < 12; x++) {
      int base = 2 + (x >= 2 && x <= 9) * 2 + (x >= 4 && x <= 7) * 2;
      h[x] = constrain(base + (int)random(-1, 3), 1, 8);
    }
  }
  clearF();
  for (int x = 0; x < 12; x++) for (int y = 0; y < h[x]; y++) px(x, 7 - y);
  if (random(3) == 0) px(random(12), random(2));   // sparks
}
static void drawTapCard(uint32_t t) {            // waiting for the manager: card slides to the reader
  clearF();
  for (int y = 1; y < 7; y++) px(11, y);
  px(10, 1); px(10, 6);
  int pos = (t / 110) % 11, cx = min(pos, 6);
  for (int x = cx; x < cx + 4; x++) { px(x, 2); px(x, 5); }
  px(cx, 3); px(cx, 4); px(cx + 3, 3); px(cx + 3, 4);
  if (pos >= 7 && (t / 140) % 2) { px(9, 0); px(10, 0); px(9, 7); px(10, 7); }   // beep!
}
static void drawBoot(uint32_t e) {               // star sparkle
  clearF();
  int r = min(4, (int)(e / 150));
  for (int i = 0; i <= r; i++) { px(5 + i, 3); px(5 - i, 3); px(5, 3 + i); px(5, 3 - i); }
  for (int k = 0; k < 6; k++) if (random(2)) px(random(12), random(8));
}

static uint32_t animMs() {
  switch (icon) {
    case ICON_IDLE: case ICON_BOLT: return 6000;
    case ICON_DROP: case ICON_FIRE: return 3500;
    case ICON_WAIT: return 3200;
    default: return 1600;
  }
}
static void startCycle() {
  phase = PH_ANIM; phaseStart = millis();
  memset(dropY, -1, sizeof dropY); puddle = 0;
}
static void drawAnim(uint32_t now) {
  uint32_t e = now - phaseStart;
  switch (icon) {
    case ICON_BOLT:
      if (e < 1200) { if ((e / 200) % 2 == 0) memcpy(frame, ICONS[ICON_BOLT], sizeof frame); else clearF(); }
      else drawGraph(now);
      break;
    case ICON_IDLE: drawGraph(now); break;
    case ICON_DROP: drawRain(now); break;
    case ICON_FIRE: drawFire(now); break;
    case ICON_WAIT: drawTapCard(now); break;
    case ICON_CHECK: {                            // the tick draws itself in
      memcpy(frame, ICONS[ICON_CHECK], sizeof frame);
      int cols = e / 70;
      for (int y = 0; y < 8; y++) for (int x = cols; x < 12; x++) frame[y][x] = 0;
      break;
    }
    case ICON_CROSS: if ((e / 250) % 2 == 0) memcpy(frame, ICONS[ICON_CROSS], sizeof frame); else clearF(); break;
    default: memcpy(frame, ICONS[icon], sizeof frame);
  }
}
static void updateMatrix() {
  uint32_t now = millis();
  if (now - lastStep < 60) return;
  lastStep = now;
  uint32_t e = now - phaseStart;
  switch (phase) {
    case PH_BOOT:
      drawBoot(e);
      if (e > 1500) { phase = PH_TEXT; scrollX = 12; }
      break;
    case PH_ANIM:
      drawAnim(now);
      if (e > animMs()) {
        if (icon == ICON_IDLE || icon == ICON_BOLT) { phase = PH_FAN; phaseStart = now; }
        else if (text[0]) { phase = PH_TEXT; scrollX = 12; }
        else startCycle();
      }
      break;
    case PH_FAN:
      drawFan(now);
      if (e > 3500 && now > fanShowUntil) { if (text[0]) { phase = PH_TEXT; scrollX = 12; } else startCycle(); }
      break;
    case PH_TEXT:
      drawText(scrollX);
      if (--scrollX < -textPx) startCycle();
      break;
  }
  matrix.renderBitmap(frame, 8, 12);
}

// --------------------------------------------------------------------- serial
char rx[160]; size_t rxLen = 0;
long watts = -1; bool flash = false; char laptopTyped[4] = "";
char localTyped[4] = ""; uint32_t lastKeyMs = 0, lastCmdMs = 0;

static void handlePanel(char* args) {
  char* t = strstr(args, "text=");
  char newText[96] = "";
  if (t) { strncpy(newText, t + 5, sizeof newText - 1); *t = 0; }
  int newIcon = icon;
  char* ic = strstr(args, "icon=");
  if (ic) { char name[12] = ""; sscanf(ic + 5, "%11s", name); for (int i = 0; i < ICON_COUNT; i++) if (!strcmp(name, ICON_NAMES[i])) newIcon = i; }
  for (char* p = newText; *p; p++) if (*p >= 'a' && *p <= 'z') *p -= 32;
  bool restart = newIcon != icon;
  icon = newIcon; strcpy(text, newText); textPx = strlen(text) * 4;
  if (restart) startCycle();                    // same icon: just update the text, keep scrolling
}
static void handleWatts(char* args) {           // "W 37 F 1 T 40 S 60"
  char w[12] = "-", t[8] = "-"; int f = 0, sp = fanPct;
  sscanf(args, "%11s F %d T %7s S %d", w, &f, t, &sp);
  sp = constrain(sp, 0, 100);
  if (lastCmdMs && abs(sp - fanPct) >= 10) {    // the fan just changed speed: announce it everywhere
    fanShowUntil = millis() + 4000;
    if (phase != PH_BOOT) { phase = PH_FAN; phaseStart = millis(); }   // matrix jumps to the fan
  }
  fanPct = sp;
  watts = (w[0] == '-') ? -1 : atol(w);
  flash = f == 1;
  if (t[0] == '-') laptopTyped[0] = 0; else { strncpy(laptopTyped, t, 3); laptopTyped[3] = 0; }
  lastCmdMs = millis();
}
static void handleLine(char* line) {
  if (line[0] == 'P' && line[1] == ' ') handlePanel(line + 2);
  else if (line[0] == 'W' && line[1] == ' ') handleWatts(line + 2);
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

static void onKey(char k) {
  Serial.print("K "); Serial.println(k);
  lastKeyMs = millis();
  if (k >= '0' && k <= '9') {                    // local echo, no waiting for the laptop
    size_t n = strlen(localTyped);
    if (n >= 2) { localTyped[0] = localTyped[1]; n = 1; }
    localTyped[n] = k; localTyped[n + 1] = 0;
  } else localTyped[0] = 0;
}

static void updateDisplayContent() {
  uint32_t now = millis();
  const char* typed = (localTyped[0] && now - lastKeyMs < 4000) ? localTyped : laptopTyped;
  if (now < fanShowUntil && !typed[0]) {        // fan speed changed: "F100" / "F 35", flashing
    segBuf[0] = ((now / 300) % 2) ? SEG_F : SEG_BLANK;
    int v = fanPct;
    for (int i = 3; i >= 1; i--) { segBuf[i] = (v || i == 3) ? DIGITS[v % 10] : SEG_BLANK; v /= 10; }
  } else if (typed[0]) {                         // entering a cut depth: "  40"
    segBuf[0] = segBuf[1] = SEG_BLANK; segBuf[2] = SEG_BLANK; segBuf[3] = SEG_BLANK;
    int n = strlen(typed);
    for (int i = 0; i < n && i < 4; i++) segBuf[4 - n + i] = DIGITS[typed[i] - '0'];
  } else if (lastCmdMs && now - lastCmdMs < 3000 && watts >= 0) segShowNumber(watts);
  else segShowDashes();                          // no laptop yet
}

// ---------------------------------------------------------------------- setup
void setup() {
  Serial.begin(115200);
  for (int i = 0; i < 7; i++) { pinMode(SEG_PINS[i], OUTPUT); digitalWrite(SEG_PINS[i], SEG_COMMON_ANODE ? HIGH : LOW); }
  for (int i = 0; i < 4; i++) { pinMode(DIG_PINS[i], OUTPUT); digitalWrite(DIG_PINS[i], SEG_COMMON_ANODE ? LOW : HIGH); }
  for (int i = 0; i < 4; i++) { pinMode(ROW_PINS[i], OUTPUT); digitalWrite(ROW_PINS[i], HIGH); pinMode(COL_PINS[i], INPUT_PULLUP); }
  matrix.begin();
  phase = PH_BOOT; phaseStart = millis();
  randomSeed(micros());   // (not analogRead: A0-A5 are display + keypad pins)
  Serial.println("HELLO sitestar-console v1");
}

void loop() {
  static uint32_t tSeg = 0, tKey = 0, tBeat = 0;
  static char held = 0;
  uint32_t now = millis();
  pollSerial();
  if (micros() - tSeg >= segSlotUs) {            // 7-seg multiplex (slot length set by segRefresh)
    tSeg = micros();
    bool visible = !flash || (now % 800) < 550;
    segRefresh(visible);
  }
  if (now - tKey >= 25) {                        // keypad: report on press, ignore while held
    tKey = now;
    char k = scanKeypad();
    if (k && k != held) onKey(k);
    held = k;
    updateDisplayContent();
  }
  sampleHistory();
  updateMatrix();
  if (now - tBeat >= 2000) { tBeat = now; Serial.print("I console up="); Serial.println(now / 1000); }
}

// GeoStar grid-event button (ESP32). Talks to the GeoStar data API (FastAPI, port 8000), the same backend
// the site optimizer uses. NOT flashed or tested on hardware in this build.
//
//   Button (GPIO 4 to GND)  -> POST /hardware/emergency {"source":"button"}  (cut depth comes from the active plan)
//   LED    (GPIO 2)         <- GET  /hardware/command   {"emergency": true|false}   polled every second
//
// Set WIFI_SSID, WIFI_PASS and API (the PC's LAN address; run uvicorn with --host 0.0.0.0 on a trusted network).
#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASS = "YOUR_PASSWORD";
const char* API = "http://192.168.1.100:8000";
const int BUTTON = 4, LED = 2;
unsigned long lastPoll = 0, lastPress = 0;

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(LED, OUTPUT);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) { delay(300); Serial.print("."); }
  Serial.println("\nconnected");
}

void loop() {
  if (digitalRead(BUTTON) == LOW && millis() - lastPress > 2000) {   // debounce + one event per 2 s
    lastPress = millis();
    HTTPClient http;
    http.begin(String(API) + "/hardware/emergency");
    http.addHeader("Content-Type", "application/json");
    int code = http.POST("{\"duration_s\":20,\"source\":\"button\"}");
    Serial.printf("grid event -> HTTP %d\n", code);
    http.end();
  }
  if (millis() - lastPoll > 1000) {
    lastPoll = millis();
    HTTPClient http;
    http.begin(String(API) + "/hardware/command");
    if (http.GET() == 200) digitalWrite(LED, http.getString().indexOf("\"emergency\":true") >= 0 ? HIGH : LOW);
    http.end();
  }
}

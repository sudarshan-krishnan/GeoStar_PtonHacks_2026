/* PlotStar ESP32 telemetry example. Planning/demo use only; does not operate safety equipment.
   Libraries: ArduinoJson 7, OneWire, DallasTemperature. ESP32 Arduino core.
   DS18B20 data: GPIO 4 with 4.7k pull-up to 3.3V. Analog moisture: GPIO 34 (ADC1).
   Configure sensors in Protect and bind BOTH sensor IDs to DEVICE_ID.
   Credentials are local firmware configuration. Never commit filled credentials.
   Use a properly configured HTTPS server and real root CA outside a trusted lab.
*/
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
// On a physical ESP32, localhost means the ESP32 itself. Use your PC's LAN address.
// See README for an explicit lab-only LAN launch command and Windows firewall setup.
const char* SERVER_URL = "http://192.168.1.100:3000/api/telemetry";
const char* API_KEY = "YOUR_TELEMETRY_API_KEY";
const char* PROJECT_ID = "YOUR_PROJECT_ID";
const char* TEMPERATURE_SENSOR_ID = "YOUR_TEMPERATURE_SENSOR_ID";
const char* WATER_SENSOR_ID = "YOUR_WATER_SENSOR_ID";
const char* DEVICE_ID = "esp32-lab-01";
// For HTTPS, replace with the PEM CA certificate for your actual server. Never use setInsecure().
const char* ROOT_CA = "";
const int WATER_PIN = 34;
const int DRY_ADC = 3200; // Calibrate to the actual sensor in air.
const int WET_ADC = 1200; // Calibrate with the actual wet reference.
OneWire oneWire(4);
DallasTemperature temperatureBus(&oneWire);
unsigned long lastSend = 0;

bool sendReading(const char* sensorId, float value) {
  if (!isfinite(value) || WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  WiFiClient client;
  WiFiClientSecure secure;
  String url(SERVER_URL);
  bool started = false;
  if (url.startsWith("https://")) {
    if (strlen(ROOT_CA) == 0) { Serial.println("Set ROOT_CA before HTTPS use"); return false; }
    secure.setCACert(ROOT_CA);
    started = http.begin(secure, url);
  } else {
    started = http.begin(client, url); // Trusted lab network only. Token is plaintext over HTTP.
  }
  if (!started) return false;
  http.setTimeout(5000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + API_KEY);
  JsonDocument doc;
  doc["projectId"] = PROJECT_ID;
  doc["sensorId"] = sensorId;
  doc["deviceId"] = DEVICE_ID;
  doc["value"] = value;
  String payload;
  serializeJson(doc, payload);
  int status = http.POST(payload);
  Serial.printf("Telemetry status: %d\n", status); // Never print token or WiFi credentials.
  http.end();
  return status >= 200 && status < 300;
}
void setup() {
  Serial.begin(115200);
  temperatureBus.begin();
  analogReadResolution(12);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  WiFi.setAutoReconnect(true);
}
void loop() {
  if (millis() - lastSend < 5000) { delay(10); return; }
  lastSend = millis();
  if (WiFi.status() != WL_CONNECTED) return;
  temperatureBus.requestTemperatures();
  float temp = temperatureBus.getTempCByIndex(0);
  if (temp != DEVICE_DISCONNECTED_C && temp >= -50 && temp <= 125) sendReading(TEMPERATURE_SENSOR_ID, temp);
  int adc = analogRead(WATER_PIN);
  float moisture = constrain((float)(DRY_ADC - adc) * 100.0f / (DRY_ADC - WET_ADC), 0.0f, 100.0f);
  sendReading(WATER_SENSOR_ID, moisture);
}

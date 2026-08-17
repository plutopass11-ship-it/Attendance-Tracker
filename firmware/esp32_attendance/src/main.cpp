#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <HardwareSerial.h>
#include <Adafruit_Fingerprint.h>
#include <Wire.h>
#include <U8g2lib.h>
#include "config.h"

// Hardware instances
HardwareSerial serialSensor(2);
Adafruit_Fingerprint finger(&serialSensor);
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, /* reset=*/ U8X8_PIN_NONE);

// State variables
bool oledAvailable = false;
unsigned long lastScanTime = 0;
unsigned long lastWifiCheck = 0;
unsigned long displayRestoreTime = 0;
bool needsDisplayRestore = false;
unsigned long lastPollTime = 0;
String currentSessionId = "";

// Enrollment state machine
enum EnrollState {
  IDLE,
  ENROLLING_STEP1,
  ENROLLING_WAIT_REMOVE,
  ENROLLING_STEP2
};
EnrollState enrollState = IDLE;
uint16_t enrollSlot = 0;
unsigned long enrollStartTime = 0;

// Forward declaration
void postEnrollProgress(const char* step, const char* status, const char* msg);

// ==========================================
// BUZZER FUNCTIONS
// ==========================================
void beep(int freq, int durationMs) {
  tone(PIN_BUZZER, freq);
  delay(durationMs);
  noTone(PIN_BUZZER);
}

void buzzerCheckIn() {
  beep(1800, 120);
  delay(80);
  beep(2400, 150);
}

void buzzerCheckOut() {
  beep(1200, 100);
  delay(50);
  beep(1800, 100);
  delay(50);
  beep(2400, 150);
}

void buzzerAlreadyDone() {
  beep(1500, 200);
}

void buzzerUnknownFinger() {
  for(int i=0; i<3; i++) {
    beep(600, 200);
    delay(100);
  }
}

void buzzerNetworkError() {
  for(int i=0; i<5; i++) {
    beep(400, 100);
    delay(50);
  }
}

void buzzerWifiConnected() {
  beep(2000, 100);
  delay(50);
  beep(2800, 150);
}

void buzzerWifiDisconnected() {
  beep(500, 500);
}

void buzzerEnrollPrompt() {
  beep(1500, 150);
}

void buzzerEnrollLiftFinger() {
  beep(1800, 100);
  delay(80);
  beep(1800, 100);
}

void buzzerEnrollSuccess() {
  beep(1200, 100);
  delay(50);
  beep(1800, 100);
  delay(50);
  beep(2400, 150);
}

void buzzerEnrollFail() {
  beep(400, 300);
  delay(100);
  beep(400, 300);
}

// ==========================================
// OLED DISPLAY FUNCTIONS
// ==========================================
void displayIdle() {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  u8g2.drawStr(0, 20, "Attendance System");
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(0, 40, "Place finger to punch");
  u8g2.sendBuffer();
}

void displayScanning() {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  u8g2.drawStr(0, 30, "Scanning...");
  u8g2.sendBuffer();
}

void displayCheckIn(const char* name, const char* timeStr) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  u8g2.drawStr(0, 15, "WELCOME!");
  u8g2.drawStr(0, 35, name);
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(0, 55, timeStr);
  u8g2.sendBuffer();
}

void displayCheckOut(const char* name, const char* timeStr, const char* hours) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  u8g2.drawStr(0, 15, "GOODBYE!");
  u8g2.drawStr(0, 35, name);
  char buf[64];
  snprintf(buf, sizeof(buf), "%s | %s", timeStr, hours);
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(0, 55, buf);
  u8g2.sendBuffer();
}

void displayAlreadyDone(const char* name) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  u8g2.drawStr(0, 25, "Already Done");
  u8g2.drawStr(0, 45, name);
  u8g2.sendBuffer();
}

void displayError(const char* msg) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  u8g2.drawStr(0, 30, "ERROR:");
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(0, 50, msg);
  u8g2.sendBuffer();
}

void displayConnecting() {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  u8g2.drawStr(0, 30, "Connecting WiFi...");
  u8g2.sendBuffer();
}

void displayEnrollStep(const char* step, uint16_t slotId) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  char buf[32];
  snprintf(buf, sizeof(buf), "Enroll Slot #%d", slotId);
  u8g2.drawStr(0, 15, buf);
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(0, 40, step);
  u8g2.sendBuffer();
}

void setupOLED() {
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.beginTransmission(0x3C);
  if (Wire.endTransmission() == 0) {
    oledAvailable = true;
  } else {
    Wire.beginTransmission(0x3D);
    if (Wire.endTransmission() == 0) {
      oledAvailable = true;
    }
  }
  
  if (oledAvailable) {
    u8g2.begin();
    Serial.println("OLED detected and initialized.");
  } else {
    Serial.println("No OLED detected.");
  }
}

// ==========================================
// WIFI FUNCTIONS
// ==========================================
void setupWifi() {
  Serial.print("Connecting to WiFi");
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected");
    buzzerWifiConnected();
  } else {
    Serial.println("WiFi connection failed!");
    buzzerWifiDisconnected();
  }
}

void checkWifi() {
  if (millis() - lastWifiCheck > WIFI_RETRY_INTERVAL) {
    lastWifiCheck = millis();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("Reconnecting to WiFi...");
      WiFi.reconnect();
    }
  }
}

// ==========================================
// FINGERPRINT FUNCTIONS
// ==========================================
void setupFingerprint() {
  serialSensor.begin(57600, SERIAL_8N1, PIN_FP_RX, PIN_FP_TX);
  finger.begin(57600);
  if (finger.verifyPassword()) {
    Serial.println("Found fingerprint sensor!");
    finger.getParameters();
    Serial.print("Capacity: "); Serial.println(finger.capacity);
  } else {
    Serial.println("Did not find fingerprint sensor :(");
  }
}

int checkFingerprint() {
  uint8_t p = finger.getImage();
  if (p == FINGERPRINT_NOFINGER) return -1;
  if (p != FINGERPRINT_OK) return -1;

  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) return -1;

  p = finger.fingerFastSearch();
  if (p == FINGERPRINT_OK) {
    return finger.fingerID;
  } else if (p == FINGERPRINT_NOTFOUND) {
    return 0;
  }
  return -1;
}

// ==========================================
// HTTP POST (API REQUEST)
// ==========================================
void postPunch(uint16_t fingerprintId) {
  if (WiFi.status() != WL_CONNECTED) {
    buzzerNetworkError();
    displayError("No WiFi!");
    return;
  }

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/biometric/punch";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(HTTP_TIMEOUT_MS);

  JsonDocument doc;
  doc["fingerprint_id"] = fingerprintId;
  String reqBody;
  serializeJson(doc, reqBody);

  int httpCode = http.POST(reqBody);
  if (httpCode > 0) {
    String payload = http.getString();
    JsonDocument resp;
    DeserializationError err = deserializeJson(resp, payload);
    
    if (!err) {
      String action = resp["action"] | "error";
      String name = resp["name"] | "Unknown";
      String timeStr = resp["time"] | "";
      
      if (action == "check_in") {
        displayCheckIn(name.c_str(), timeStr.c_str());
        buzzerCheckIn();
        Serial.printf("CHECK-IN: %s at %s\n", name.c_str(), timeStr.c_str());
      } else if (action == "check_out") {
        String hours = resp["hours_worked"] | "";
        displayCheckOut(name.c_str(), timeStr.c_str(), hours.c_str());
        buzzerCheckOut();
        Serial.printf("CHECK-OUT: %s at %s (%s)\n", name.c_str(), timeStr.c_str(), hours.c_str());
      } else if (action == "already_completed") {
        displayAlreadyDone(name.c_str());
        buzzerAlreadyDone();
        Serial.printf("ALREADY DONE: %s\n", name.c_str());
      } else if (action == "unknown") {
        displayError("Not Enrolled");
        buzzerUnknownFinger();
        Serial.println("Fingerprint not enrolled in system");
      } else {
        displayError("Invalid Response");
        buzzerNetworkError();
        Serial.printf("Unknown action: %s\n", action.c_str());
      }
    } else {
      displayError("JSON Parse Err");
      buzzerNetworkError();
    }
  } else {
    displayError(http.errorToString(httpCode).c_str());
    buzzerNetworkError();
    Serial.printf("HTTP Error: %d\n", httpCode);
  }
  http.end();
}

// ==========================================
// WEB ENROLLMENT PROGRESS & POLLING
// ==========================================
void postEnrollProgress(const char* step, const char* status, const char* msg) {
  if (currentSessionId.length() == 0 || WiFi.status() != WL_CONNECTED) return;
  
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/biometric/enroll/progress";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(3000);

  JsonDocument doc;
  doc["session_id"] = currentSessionId;
  doc["step"] = step;
  doc["status"] = status;
  doc["message"] = msg;
  String reqBody;
  serializeJson(doc, reqBody);

  http.POST(reqBody);
  http.end();
}

void pollBackendCommands() {
  if (WiFi.status() != WL_CONNECTED || enrollState != IDLE) return;
  if (millis() - lastPollTime < POLL_INTERVAL_MS) return;
  lastPollTime = millis();

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/biometric/device/poll";
  http.begin(url);
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(2000);

  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload);
    if (!err) {
      String cmd = doc["command"] | "idle";
      if (cmd == "enroll") {
        enrollSlot = doc["slot"] | 0;
        currentSessionId = doc["session_id"].as<String>();
        if (enrollSlot > 0) {
          enrollState = ENROLLING_STEP1;
          enrollStartTime = millis();
          buzzerEnrollPrompt();
          displayEnrollStep("Place finger", enrollSlot);
          Serial.printf("\n[WEB ENROLL] Starting enrollment for Slot #%d (Session: %s)\n", enrollSlot, currentSessionId.c_str());
          postEnrollProgress("place_finger", "ok", "Place finger on sensor");
        }
      }
    }
  }
  http.end();
}

// ==========================================
// SERIAL ENROLLMENT COMMANDS
// ==========================================
void processSerialCommands() {
  if (!Serial.available()) return;
  
  String cmdLine = Serial.readStringUntil('\n');
  cmdLine.trim();
  if (cmdLine.length() == 0) return;

  if (cmdLine.startsWith("enroll ")) {
    enrollSlot = cmdLine.substring(7).toInt();
    if (enrollSlot > 0) {
      enrollState = ENROLLING_STEP1;
      enrollStartTime = millis();
      currentSessionId = ""; // local serial session
      buzzerEnrollPrompt();
      displayEnrollStep("Place finger", enrollSlot);
      Serial.printf("Enrolling slot %d. Place finger...\n", enrollSlot);
    }
  } else if (cmdLine.startsWith("delete ")) {
    uint16_t slot = cmdLine.substring(7).toInt();
    if (finger.deleteModel(slot) == FINGERPRINT_OK) {
      Serial.printf("Deleted slot %d\n", slot);
    } else {
      Serial.printf("Failed to delete slot %d\n", slot);
    }
  } else if (cmdLine == "list") {
    finger.getTemplateCount();
    Serial.printf("Templates stored: %d\n", finger.templateCount);
    Serial.printf("Capacity: %d\n", finger.capacity);
  } else if (cmdLine == "clear") {
    if (finger.emptyDatabase() == FINGERPRINT_OK) {
      Serial.println("Database cleared!");
    } else {
      Serial.println("Failed to clear database.");
    }
  } else {
    Serial.println("Commands: enroll <slot>, delete <slot>, list, clear");
  }
}
 
void handleEnrollment() {
  if (enrollState == IDLE) return;

  // 20 second timeout
  if (millis() - enrollStartTime > 20000) {
    buzzerEnrollFail();
    Serial.println("\n[ENROLL TIMEOUT] Enrollment timed out. Returning to IDLE.");
    displayIdle();
    postEnrollProgress("timeout", "error", "Enrollment timed out");
    currentSessionId = "";
    enrollState = IDLE;
    return;
  }

  switch (enrollState) {
    case IDLE:
      break;
    
    case ENROLLING_STEP1: {
      uint8_t p = finger.getImage();
      if (p == FINGERPRINT_OK) {
        p = finger.image2Tz(1);
        if (p == FINGERPRINT_OK) {
          buzzerEnrollLiftFinger();
          displayEnrollStep("Remove finger", enrollSlot);
          Serial.println("  ✓ Scan 1 OK! Please REMOVE your finger...");
          postEnrollProgress("scan1_ok", "ok", "First scan captured. Lift finger.");
          enrollState = ENROLLING_WAIT_REMOVE;
        } else {
          Serial.printf("  ✗ Scan 1 feature extraction failed (code: %d). Try again.\n", p);
        }
      }
      break;
    }

    case ENROLLING_WAIT_REMOVE: {
      uint8_t p = finger.getImage();
      if (p == FINGERPRINT_NOFINGER) {
        buzzerEnrollPrompt();
        displayEnrollStep("Place again", enrollSlot);
        Serial.println("  ✓ Finger removed. Now place the SAME finger again...");
        postEnrollProgress("place_again", "ok", "Place same finger again.");
        enrollState = ENROLLING_STEP2;
      }
      break;
    }

    case ENROLLING_STEP2: {
      uint8_t p = finger.getImage();
      if (p == FINGERPRINT_OK) {
        p = finger.image2Tz(2);
        if (p == FINGERPRINT_OK) {
          p = finger.createModel();
          if (p == FINGERPRINT_OK) {
            p = finger.storeModel(enrollSlot);
            if (p == FINGERPRINT_OK) {
              buzzerEnrollSuccess();
              Serial.printf("\n🎉 SUCCESS: Fingerprint enrolled into Slot #%d!\n", enrollSlot);
              displayIdle();
              postEnrollProgress("success", "ok", "Enrolled successfully!");
              currentSessionId = "";
              enrollState = IDLE;
              return;
            } else {
              Serial.printf("  ✗ Storage error (code: %d)\n", p);
            }
          } else {
            Serial.println("  ✗ Prints did not match! Try enrollment again.");
          }
          buzzerEnrollFail();
          displayIdle();
          postEnrollProgress("fail", "error", "Prints did not match");
          currentSessionId = "";
          enrollState = IDLE;
        } else {
          Serial.printf("  ✗ Scan 2 feature extraction failed (code: %d). Try again.\n", p);
        }
      }
      break;
    }
  }
}

// ==========================================
// ARDUINO LIFECYCLE
// ==========================================
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT);
  
  setupOLED();
  displayConnecting();
  setupWifi();
  setupFingerprint();
  
  displayIdle();
  Serial.println("===============================");
  Serial.println("Attendance System Initialized");
  Serial.println("Commands: enroll <slot>, delete <slot>, list, clear");
  Serial.println("===============================");
}

void loop() {
  processSerialCommands();
  
  if (enrollState != IDLE) {
    handleEnrollment();
    delay(50);
    return; // Skip normal operations while in enrollment flow
  }

  checkWifi();
  pollBackendCommands();

  // Handle display restore non-blockingly
  if (needsDisplayRestore && millis() > displayRestoreTime) {
    displayIdle();
    needsDisplayRestore = false;
  }

  int fingerId = checkFingerprint();
  if (fingerId > 0) { // Valid finger match
    if (millis() - lastScanTime > SCAN_COOLDOWN_MS) {
      displayScanning();
      postPunch(fingerId);
      lastScanTime = millis();
      displayRestoreTime = millis() + 3000;
      needsDisplayRestore = true;
    }
  } else if (fingerId == 0) { // Finger found but no match
    if (millis() - lastScanTime > SCAN_COOLDOWN_MS) {
      buzzerUnknownFinger();
      displayError("Unknown Finger");
      lastScanTime = millis();
      displayRestoreTime = millis() + 3000;
      needsDisplayRestore = true;
    }
  }
  
  delay(50); // Small delay to prevent CPU hogging
}

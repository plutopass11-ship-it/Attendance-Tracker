#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <HardwareSerial.h>
#include <Adafruit_Fingerprint.h>
#include <Wire.h>
#include <U8g2lib.h>
#include <ArduinoOTA.h>
#include <ESPmDNS.h>
#include <time.h>
#include <sys/time.h>
#include <Preferences.h>
#include <WebServer.h>
#include "config.h"

// Hardware instances
HardwareSerial serialSensor(2);
Adafruit_Fingerprint finger(&serialSensor);
U8G2_SH1106_128X64_NONAME_F_HW_I2C u8g2(U8G2_R0, /* reset=*/ U8X8_PIN_NONE);
WebServer localServer(80);

// State variables
bool oledAvailable = false;
unsigned long lastScanTime = 0;
unsigned long lastWifiCheck = 0;
unsigned long displayRestoreTime = 0;
bool needsDisplayRestore = false;
unsigned long lastPollTime = 0;
String currentSessionId = "";

// Time synchronization state
bool timeHasBeenSynced = false;
unsigned long lastTimeSyncMs = 0;

// ==========================================
// OFFLINE QUEUE (STORE-AND-FORWARD) & CACHE
// ==========================================
Preferences prefs;

struct QueuedPunch {
  uint16_t slot;
  uint32_t epoch;
};

#define MAX_OFFLINE_PUNCHES 50
QueuedPunch offlineQueue[MAX_OFFLINE_PUNCHES];
int offlineQueueCount = 0;
bool queueLoaded = false;
unsigned long lastQueueFlushTime = 0;
bool isFlushingQueue = false;

struct CachedUser {
  uint16_t slot;
  char name[24];
};
CachedUser userCache[32];
int userCacheCount = 0;
unsigned long lastUserCacheFetch = 0;

void loadOfflineQueue() {
  if (queueLoaded) return;
  prefs.begin("bio_queue", false);
  offlineQueueCount = prefs.getInt("count", 0);
  if (offlineQueueCount > MAX_OFFLINE_PUNCHES) offlineQueueCount = MAX_OFFLINE_PUNCHES;
  if (offlineQueueCount > 0) {
    size_t expectedSize = offlineQueueCount * sizeof(QueuedPunch);
    size_t readSize = prefs.getBytes("punches", offlineQueue, expectedSize);
    if (readSize != expectedSize) {
      Serial.println("[QUEUE] Mismatch in queue bytes, resetting count.");
      offlineQueueCount = 0;
      prefs.putInt("count", 0);
    } else {
      Serial.printf("[QUEUE] Loaded %d offline punch(es) from flash.\n", offlineQueueCount);
    }
  }
  prefs.end();
  queueLoaded = true;
}

void saveOfflineQueue() {
  prefs.begin("bio_queue", false);
  prefs.putInt("count", offlineQueueCount);
  if (offlineQueueCount > 0) {
    prefs.putBytes("punches", offlineQueue, offlineQueueCount * sizeof(QueuedPunch));
  }
  prefs.end();
}

bool enqueueOfflinePunch(uint16_t slot, uint32_t epoch) {
  loadOfflineQueue();
  if (offlineQueueCount >= MAX_OFFLINE_PUNCHES) {
    Serial.println("[QUEUE] Offline queue FULL! Cannot store more punches.");
    return false;
  }
  offlineQueue[offlineQueueCount].slot = slot;
  offlineQueue[offlineQueueCount].epoch = epoch;
  offlineQueueCount++;
  saveOfflineQueue();
  Serial.printf("[QUEUE] Stored offline punch for Slot #%d (epoch: %u). Total queued: %d\n", slot, epoch, offlineQueueCount);
  return true;
}

void fetchAndCacheUsers() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/biometric/users";
  http.begin(url);
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(3000);
  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK) {
    String payload = http.getString();
    JsonDocument doc;
    if (!deserializeJson(doc, payload)) {
      JsonArray users = doc["users"].as<JsonArray>();
      userCacheCount = 0;
      for (JsonObject u : users) {
        if (userCacheCount < 32) {
          userCache[userCacheCount].slot = u["fingerprint_id"] | 0;
          const char* n = u["name"] | "Employee";
          strncpy(userCache[userCacheCount].name, n, sizeof(userCache[userCacheCount].name) - 1);
          userCache[userCacheCount].name[sizeof(userCache[userCacheCount].name) - 1] = '\0';
          userCacheCount++;
        }
      }
      lastUserCacheFetch = millis();
      Serial.printf("[CACHE] Cached %d active user name(s) for offline display.\n", userCacheCount);
    }
  }
  http.end();
}

const char* getCachedUserName(uint16_t slot) {
  for (int i = 0; i < userCacheCount; i++) {
    if (userCache[i].slot == slot) {
      return userCache[i].name;
    }
  }
  return "Employee";
}

time_t calcEpochFromUTC(int year, int month, int day, int hour, int min, int sec) {
  const int daysBeforeMonth[] = {0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334};
  bool isLeap = (year % 4 == 0 && (year % 100 != 0 || year % 400 == 0));
  int y = year - 1;
  int leapDays = (y / 4) - (y / 100) + (y / 400) - ((1969 / 4) - (1969 / 100) + (1969 / 400));
  long days = (long)(year - 1970) * 365 + leapDays + daysBeforeMonth[month] + (month > 1 && isLeap ? 1 : 0) + (day - 1);
  return (time_t)(days * 86400LL + hour * 3600LL + min * 60LL + sec);
}

void setTimeEpoch(time_t epoch) {
  if (epoch > 1700000000) {
    struct timeval tv = { .tv_sec = epoch, .tv_usec = 0 };
    settimeofday(&tv, NULL);
    timeHasBeenSynced = true;
    lastTimeSyncMs = millis();
    Serial.printf("[TIME] System clock set to UTC epoch: %lld\n", (long long)epoch);
  }
}

void syncTimeFromHttpDate(const String& dateStr) {
  if (timeHasBeenSynced && (millis() - lastTimeSyncMs < 60000)) return;

  int comma = dateStr.indexOf(',');
  if (comma < 0) return;
  String trimmed = dateStr.substring(comma + 1);
  trimmed.trim();

  char monStr[4] = {0};
  int day = 0, year = 0, hour = 0, min = 0, sec = 0;
  if (sscanf(trimmed.c_str(), "%d %3s %d %d:%d:%d", &day, monStr, &year, &hour, &min, &sec) >= 6) {
    const char* months[] = {"Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
    int month = -1;
    for (int i = 0; i < 12; i++) {
      if (strcasecmp(monStr, months[i]) == 0) {
        month = i;
        break;
      }
    }
    if (month >= 0 && year >= 2024) {
      time_t epoch = calcEpochFromUTC(year, month, day, hour, min, sec);
      setTimeEpoch(epoch);
      Serial.printf("[HTTP TIME] Clock synced from server: %02d:%02d:%02d GMT (Date: %d %s %d)\n", hour, min, sec, day, monStr, year);
    }
  }
}

void triggerInitialTimeSync() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/biometric/device/poll";
  http.begin(url);
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(3000);
  const char* headerKeys[] = { "Date" };
  http.collectHeaders(headerKeys, 1);
  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK) {
    if (http.hasHeader("Date")) {
      syncTimeFromHttpDate(http.header("Date"));
    }
    String payload = http.getString();
    JsonDocument doc;
    if (!deserializeJson(doc, payload)) {
      if (doc.containsKey("epoch")) {
        setTimeEpoch(doc["epoch"].as<time_t>());
      }
    }
  }
  http.end();
}

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

void buzzerHappyBirthday() {
  // Complete Happy Birthday to You Melody (Full 4 Phrases)
  // Notes in Hz: C4=262, D4=294, E4=330, F4=349, G4=392, A4=440, Bb4=466, C5=523, 0=Rest
  const int notes[] = {
    // Phrase 1: "Happy Birthday to you"
    262, 262, 294, 262, 349, 330, 0,
    // Phrase 2: "Happy Birthday to you"
    262, 262, 294, 262, 392, 349, 0,
    // Phrase 3: "Happy Birthday dear [Name]" (Octave jump to C5)
    262, 262, 523, 440, 349, 330, 294, 0,
    // Phrase 4: "Happy Birthday to you!" (Grand finale with Bb4)
    466, 466, 440, 349, 392, 349
  };

  const int durations[] = {
    // Phrase 1
    220, 200, 400, 400, 400, 700, 120,
    // Phrase 2
    220, 200, 400, 400, 400, 700, 120,
    // Phrase 3
    220, 200, 440, 400, 400, 400, 700, 120,
    // Phrase 4
    220, 200, 400, 400, 440, 900
  };

  const int count = sizeof(notes) / sizeof(notes[0]);

  for (int i = 0; i < count; i++) {
    if (notes[i] > 0) {
      tone(PIN_BUZZER, notes[i]);
      delay(durations[i]);
      noTone(PIN_BUZZER);
    } else {
      delay(durations[i]);
    }
    delay(35); // Crisp articulation pause between notes
  }
}

void buzzerOfflineSaved() {
  beep(1800, 100);
  delay(40);
  beep(2200, 150);
}

// ==========================================
// OLED DISPLAY FUNCTIONS
// ==========================================
void drawCenteredStr(int y, const char* str) {
  int width = u8g2.getStrWidth(str);
  int x = (128 - width) / 2;
  if (x < 0) x = 0;
  u8g2.drawStr(x, y, str);
}

// Procedural Bauhaus Geometric Digits for Hero Clock (matching reference photo)
void drawBlockDigit(int x, int y, char d) {
  int w = 18;
  int h = 38;
  int t = 5;
  switch (d) {
    case '0':
      u8g2.drawBox(x, y, w, h);
      u8g2.setDrawColor(0);
      u8g2.drawBox(x + t, y + t, w - 2*t, h - 2*t);
      u8g2.setDrawColor(1);
      break;
    case '1':
      u8g2.drawBox(x + 5, y, 8, h);
      break;
    case '2':
      u8g2.drawBox(x, y, w, t);
      u8g2.drawBox(x + w - t, y, t, h/2);
      u8g2.drawBox(x, y + (h - t)/2, w, t);
      u8g2.drawBox(x, y + (h - t)/2, t, h/2);
      u8g2.drawBox(x, y + h - t, w, t);
      break;
    case '3':
      u8g2.drawBox(x, y, w, t);
      u8g2.drawBox(x + w - t, y, t, h);
      u8g2.drawBox(x + t, y + (h - t)/2, w - t, t);
      u8g2.drawBox(x, y + h - t, w, t);
      break;
    case '4':
      u8g2.drawBox(x, y, t, h/2 + t/2);
      u8g2.drawBox(x, y + (h - t)/2, w, t);
      u8g2.drawBox(x + w - t, y, t, h);
      break;
    case '5':
      u8g2.drawBox(x, y, w, t);
      u8g2.drawBox(x, y, t, h/2);
      u8g2.drawBox(x, y + (h - t)/2, w, t);
      u8g2.drawBox(x + w - t, y + (h - t)/2, t, h/2);
      u8g2.drawBox(x, y + h - t, w, t);
      break;
    case '6':
      u8g2.drawBox(x, y, t, h);
      u8g2.drawBox(x, y, w, t);
      u8g2.drawBox(x, y + (h - t)/2, w, t);
      u8g2.drawBox(x + w - t, y + (h - t)/2, t, h/2);
      u8g2.drawBox(x, y + h - t, w, t);
      break;
    case '7':
      u8g2.drawBox(x, y, w, t);
      u8g2.drawBox(x + w - t, y, t, h);
      break;
    case '8':
      u8g2.drawBox(x, y, w, h);
      u8g2.setDrawColor(0);
      u8g2.drawBox(x + t, y + t, w - 2*t, (h - 3*t)/2);
      u8g2.drawBox(x + t, y + h/2 + t/4, w - 2*t, (h - 3*t)/2);
      u8g2.setDrawColor(1);
      break;
    case '9':
      u8g2.drawBox(x, y, w, t);
      u8g2.drawBox(x, y, t, h/2);
      u8g2.drawBox(x, y + (h - t)/2, w, t);
      u8g2.drawBox(x + w - t, y, t, h);
      u8g2.drawBox(x, y + h - t, w, t);
      break;
    default:
      u8g2.drawBox(x, y + (h - t)/2, w, t);
      break;
  }
}

void drawBlockColon(int x, int y, int h) {
  u8g2.drawBox(x, y + 10, 4, 5);
  u8g2.drawBox(x, y + 23, 4, 5);
}

void displayIdleClock() {
  if (!oledAvailable) return;
  u8g2.clearBuffer();

  // Top segmented accent bar (reference photo)
  u8g2.drawBox(2, 2, 24, 2);
  u8g2.drawHLine(28, 2, 70);
  u8g2.setFont(u8g2_font_4x6_tr);
  if (WiFi.status() == WL_CONNECTED) {
    if (offlineQueueCount > 0) {
      char qBuf[16];
      snprintf(qBuf, sizeof(qBuf), "Q:%d", offlineQueueCount);
      int qW = u8g2.getStrWidth(qBuf);
      u8g2.drawStr(122 - qW, 6, qBuf);
    } else {
      u8g2.drawStr(107, 6, "WiFi");
    }
  } else {
    if (offlineQueueCount > 0) {
      char qBuf[16];
      snprintf(qBuf, sizeof(qBuf), "!Q:%d!", offlineQueueCount);
      int qW = u8g2.getStrWidth(qBuf);
      u8g2.drawStr(122 - qW, 6, qBuf);
    } else {
      u8g2.drawStr(101, 6, "!OFF!");
    }
  }
  u8g2.drawBox(124, 2, 2, 2);

  // Time & Date via NTP or HTTP sync
  struct tm timeinfo;
  char timeStr[6] = "12:00";
  char dateStr[12] = "READY";
  time_t now;
  time(&now);
  if (now > 1700000000) {
    localtime_r(&now, &timeinfo);
    strftime(timeStr, sizeof(timeStr), "%H:%M", &timeinfo);
    strftime(dateStr, sizeof(dateStr), "%d %b", &timeinfo);
    for (int i=0; dateStr[i]; i++) dateStr[i] = toupper(dateStr[i]);
  } else if (getLocalTime(&timeinfo, 10)) {
    strftime(timeStr, sizeof(timeStr), "%H:%M", &timeinfo);
    strftime(dateStr, sizeof(dateStr), "%d %b", &timeinfo);
    for (int i=0; dateStr[i]; i++) dateStr[i] = toupper(dateStr[i]);
  }

  // Draw 4 Bauhaus block digits + colon
  int y = 9;
  int h = 38;
  drawBlockDigit(17, y, timeStr[0]);
  drawBlockDigit(39, y, timeStr[1]);
  drawBlockColon(62, y, h);
  drawBlockDigit(70, y, timeStr[3]);
  drawBlockDigit(92, y, timeStr[4]);

  // Bottom row (reference photo)
  u8g2.drawHLine(2, 51, 124);
  u8g2.setFont(u8g2_font_4x6_tr);
  u8g2.drawStr(2, 60, "PLACE FINGER");
  int dW = u8g2.getStrWidth(dateStr);
  u8g2.drawStr(126 - dW, 60, dateStr);

  u8g2.sendBuffer();
}

void displayIdle() {
  displayIdleClock();
}

void displayScanning() {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.drawBox(0, 0, 128, 11);
  u8g2.setDrawColor(0);
  u8g2.setFont(u8g2_font_5x7_tr);
  u8g2.drawStr(3, 8, "VERIFYING BIOMETRICS");
  u8g2.setDrawColor(1);
  u8g2.setFont(u8g2_font_7x14B_tr);
  drawCenteredStr(36, "SCANNING...");
  u8g2.drawHLine(14, 52, 100);
  u8g2.sendBuffer();
}

const char* ADMIN_CHECKIN_QUOTES[] = {
  "Welcome, Boss!",
  "All set for you, Boss",
  "Good morning, Boss",
  "Make it happen, Boss",
  "All systems green, Boss"
};
const int NUM_ADMIN_CHECKIN = 5;

const char* ADMIN_CHECKOUT_QUOTES[] = {
  "Have a great evening, Boss",
  "Until tomorrow, Boss",
  "Don't look at Slack, Boss",
  "Over & out, Chief!",
  "Admin locked out safely"
};
const int NUM_ADMIN_CHECKOUT = 5;

const char* FAREWELL_QUOTES[] = {
  "Have a great night!",
  "Good Bye!",
  "Sheri enna !!",
  "Will miss you!",
  "Good Bye & Thank you",
  "Rest up well!",
  "See you tomorrow!"
};
const int NUM_FAREWELLS = 7;

void displayCheckIn(const char* name, const char* timeStr, uint16_t slot = 0, bool isAdmin = false) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  // Inverted header bar
  u8g2.drawBox(0, 0, 128, 12);
  u8g2.setDrawColor(0);
  u8g2.setFont(u8g2_font_6x10_tr);
  if (isAdmin) {
    u8g2.drawStr(3, 9, "ADMIN CHECK-IN");
  } else {
    u8g2.drawStr(3, 9, "CHECK-IN");
  }
  if (timeStr && strlen(timeStr) > 0) {
    int tW = u8g2.getStrWidth(timeStr);
    u8g2.drawStr(125 - tW, 9, timeStr);
  }
  u8g2.setDrawColor(1);

  if (isAdmin) {
    // Admin Mode: Big Name + Random Boss Quote
    u8g2.setFont(u8g2_font_ncenB10_tr);
    drawCenteredStr(27, name);
    int qIdx = random(NUM_ADMIN_CHECKIN);
    const char* quote = ADMIN_CHECKIN_QUOTES[qIdx];
    u8g2.setFont(u8g2_font_5x7_tr);
    if (u8g2.getStrWidth(quote) > 124) {
      u8g2.setFont(u8g2_font_4x6_tr);
    }
    drawCenteredStr(41, quote);

    // Bottom row
    u8g2.drawHLine(0, 51, 128);
    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.drawStr(2, 60, "STATUS: MASTER ADMIN");
    char slotBuf[16];
    snprintf(slotBuf, sizeof(slotBuf), "SLOT #%d", slot);
    int sW = u8g2.getStrWidth(slotBuf);
    u8g2.drawStr(126 - sW, 60, slotBuf);
  } else {
    // Normal User Mode
    u8g2.setFont(u8g2_font_5x7_tr);
    drawCenteredStr(26, "WELCOME BACK");
    u8g2.setFont(u8g2_font_ncenB10_tr);
    drawCenteredStr(42, name);

    // Bottom row
    u8g2.drawHLine(0, 51, 128);
    u8g2.setFont(u8g2_font_5x7_tr);
    u8g2.drawStr(2, 60, "STATUS: ON CLOCK");
    char slotBuf[16];
    snprintf(slotBuf, sizeof(slotBuf), "SLOT #%d", slot);
    int sW = u8g2.getStrWidth(slotBuf);
    u8g2.drawStr(126 - sW, 60, slotBuf);
  }
  u8g2.sendBuffer();
}

void displayCheckOut(const char* name, const char* timeStr, const char* hours, bool isAdmin = false) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  // Inverted header bar
  u8g2.drawBox(0, 0, 128, 12);
  u8g2.setDrawColor(0);
  u8g2.setFont(u8g2_font_6x10_tr);
  if (isAdmin) {
    u8g2.drawStr(3, 9, "ADMIN CHECK-OUT");
  } else {
    u8g2.drawStr(3, 9, "CHECK-OUT");
  }
  if (timeStr && strlen(timeStr) > 0) {
    int tW = u8g2.getStrWidth(timeStr);
    u8g2.drawStr(125 - tW, 9, timeStr);
  }
  u8g2.setDrawColor(1);

  // Center Name & Random Quote
  u8g2.setFont(u8g2_font_ncenB08_tr);
  drawCenteredStr(26, name);

  const char* quote;
  if (isAdmin) {
    int qIdx = random(NUM_ADMIN_CHECKOUT);
    quote = ADMIN_CHECKOUT_QUOTES[qIdx];
  } else {
    int qIdx = random(NUM_FAREWELLS);
    quote = FAREWELL_QUOTES[qIdx];
  }

  u8g2.setFont(u8g2_font_5x7_tr);
  if (u8g2.getStrWidth(quote) > 124) {
    u8g2.setFont(u8g2_font_4x6_tr);
  }
  drawCenteredStr(41, quote);

  // Bottom row with hours and solid pill
  u8g2.drawHLine(0, 51, 128);
  u8g2.setFont(u8g2_font_5x7_tr);
  char hrBuf[32];
  snprintf(hrBuf, sizeof(hrBuf), "WORKED: %s", (hours && strlen(hours) > 0) ? hours : "--");
  u8g2.drawStr(2, 60, hrBuf);
  u8g2.drawBox(90, 53, 36, 9);
  u8g2.setDrawColor(0);
  u8g2.setFont(u8g2_font_4x6_tr);
  if (isAdmin) {
    u8g2.drawStr(96, 60, "ADMIN");
  } else {
    u8g2.drawStr(95, 60, "COMPL");
  }
  u8g2.setDrawColor(1);
  u8g2.sendBuffer();
}

void displayAlreadyDone(const char* name) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.drawBox(0, 0, 128, 12);
  u8g2.setDrawColor(0);
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(3, 9, "ALREADY LOGGED");
  u8g2.drawStr(98, 9, "DONE");
  u8g2.setDrawColor(1);

  u8g2.setFont(u8g2_font_ncenB08_tr);
  drawCenteredStr(28, name);
  u8g2.setFont(u8g2_font_6x10_tr);
  drawCenteredStr(42, "Shift Complete!");

  u8g2.drawHLine(0, 51, 128);
  u8g2.setFont(u8g2_font_5x7_tr);
  u8g2.drawStr(2, 60, "NO ACTION NEEDED");
  u8g2.drawStr(88, 60, "REST UP!");
  u8g2.sendBuffer();
}

void displayRetry() {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  // Top subtle line
  u8g2.drawHLine(0, 8, 128);
  u8g2.setFont(u8g2_font_5x7_tr);
  u8g2.drawStr(2, 6, "SCAN FAILED");
  u8g2.drawStr(82, 6, "TRY AGAIN");

  // Center Big Title
  u8g2.setFont(u8g2_font_7x14B_tr);
  drawCenteredStr(25, "NOT RECOGNIZED");

  // Inverted RETRY Pill
  u8g2.drawBox(32, 30, 64, 13);
  u8g2.setDrawColor(0);
  u8g2.setFont(u8g2_font_6x10_tr);
  drawCenteredStr(40, "! RETRY !");
  u8g2.setDrawColor(1);

  // Subtext
  u8g2.setFont(u8g2_font_5x7_tr);
  drawCenteredStr(52, "PRESS FLAT & FIRMLY");

  // Bottom line
  u8g2.drawHLine(0, 56, 128);
  u8g2.setFont(u8g2_font_4x6_tr);
  u8g2.drawStr(2, 63, "CLEAN SENSOR");
  u8g2.drawStr(78, 63, "AUTO-RESET 2S");
  u8g2.sendBuffer();
}

void displayBirthday(const char* name) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();

  // Top celebratory line
  u8g2.drawHLine(0, 8, 128);
  u8g2.setFont(u8g2_font_4x6_tr);
  u8g2.drawStr(2, 6, "* SPECIAL DAY *");
  u8g2.drawStr(72, 6, "PUNCH LOGGED");

  // Center Hero: Solid Inverted "HAPPY BIRTHDAY!"
  u8g2.drawBox(8, 13, 112, 14);
  u8g2.setDrawColor(0);
  u8g2.setFont(u8g2_font_6x10_tr);
  drawCenteredStr(23, "* HAPPY BIRTHDAY! *");
  u8g2.setDrawColor(1);

  // Employee Name in Middle
  u8g2.setFont(u8g2_font_7x14B_tr);
  drawCenteredStr(40, name);

  // Greeting
  u8g2.setFont(u8g2_font_4x6_tr);
  drawCenteredStr(49, "WISHING YOU A GREAT YEAR!");

  // Bottom line
  u8g2.drawHLine(0, 54, 128);
  u8g2.setFont(u8g2_font_4x6_tr);
  u8g2.drawStr(2, 62, "FROM: TEAM PLUTO");
  u8g2.drawStr(76, 62, "ENJOY YOUR DAY!");

  u8g2.sendBuffer();
}

void displayOfflineSaved(const char* name, uint16_t slot, const char* timeStr) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  // Inverted header bar
  u8g2.drawBox(0, 0, 128, 12);
  u8g2.setDrawColor(0);
  u8g2.setFont(u8g2_font_6x10_tr);
  u8g2.drawStr(3, 9, "OFFLINE RECORDED");
  if (timeStr && strlen(timeStr) > 0) {
    int tW = u8g2.getStrWidth(timeStr);
    u8g2.drawStr(125 - tW, 9, timeStr);
  }
  u8g2.setDrawColor(1);

  // Employee Name
  u8g2.setFont(u8g2_font_ncenB10_tr);
  drawCenteredStr(27, name);

  // Status message
  u8g2.setFont(u8g2_font_5x7_tr);
  drawCenteredStr(41, "* SAVED TO FLASH *");

  // Bottom row
  u8g2.drawHLine(0, 51, 128);
  u8g2.setFont(u8g2_font_5x7_tr);
  u8g2.drawStr(2, 60, "SYNC WHEN ONLINE");
  char slotBuf[16];
  snprintf(slotBuf, sizeof(slotBuf), "SLOT #%d", slot);
  int sW = u8g2.getStrWidth(slotBuf);
  u8g2.drawStr(126 - sW, 60, slotBuf);
  u8g2.sendBuffer();
}

void displayError(const char* msg) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  drawCenteredStr(26, "ERROR:");
  u8g2.setFont(u8g2_font_6x10_tr);
  drawCenteredStr(46, msg);
  u8g2.sendBuffer();
}

void displayConnecting() {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  drawCenteredStr(36, "Connecting WiFi...");
  u8g2.sendBuffer();
}

void displayEnrollStep(const char* step, uint16_t slotId) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  char buf[32];
  snprintf(buf, sizeof(buf), "Enroll Slot #%d", slotId);
  drawCenteredStr(20, buf);
  u8g2.setFont(u8g2_font_6x10_tr);
  drawCenteredStr(44, step);
  u8g2.sendBuffer();
}

void displayWifiConnected(const char* ip) {
  if (!oledAvailable) return;
  u8g2.clearBuffer();
  u8g2.setFont(u8g2_font_ncenB08_tr);
  drawCenteredStr(20, "WiFi Connected");
  u8g2.setFont(u8g2_font_6x10_tr);
  drawCenteredStr(38, ip);
  drawCenteredStr(54, "OTA Ready");
  u8g2.sendBuffer();
  delay(1200);
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
// ARDUINO OTA (WIRELESS FLASHING)
// ==========================================
void setupOTA() {
  ArduinoOTA.setHostname("esp32-attendance");

  ArduinoOTA.onStart([]() {
    String type;
    if (ArduinoOTA.getCommand() == U_FLASH) {
      type = "sketch";
    } else {
      type = "filesystem";
    }
    Serial.println("\n[OTA] Start updating " + type);
    if (oledAvailable) {
      u8g2.clearBuffer();
      u8g2.setFont(u8g2_font_ncenB08_tr);
      drawCenteredStr(24, "OTA Flashing...");
      u8g2.setFont(u8g2_font_6x10_tr);
      drawCenteredStr(44, "Do not unplug!");
      u8g2.sendBuffer();
    }
  });

  ArduinoOTA.onEnd([]() {
    Serial.println("\n[OTA] Update Complete! Rebooting...");
    if (oledAvailable) {
      u8g2.clearBuffer();
      u8g2.setFont(u8g2_font_ncenB08_tr);
      drawCenteredStr(34, "OTA Success!");
      u8g2.sendBuffer();
    }
  });

  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    static unsigned int lastPct = 999;
    unsigned int pct = (progress / (total / 100));
    if (pct != lastPct) {
      lastPct = pct;
      Serial.printf("[OTA] Progress: %u%%\r", pct);
      if (oledAvailable && (pct % 5 == 0 || pct == 100)) {
        u8g2.clearBuffer();
        u8g2.setFont(u8g2_font_ncenB08_tr);
        drawCenteredStr(18, "OTA Update");
        char pctStr[16];
        snprintf(pctStr, sizeof(pctStr), "%u%%", pct);
        u8g2.setFont(u8g2_font_6x10_tr);
        drawCenteredStr(34, pctStr);
        u8g2.drawFrame(14, 42, 100, 8);
        int fillWidth = (pct * 96) / 100;
        if (fillWidth > 96) fillWidth = 96;
        u8g2.drawBox(16, 44, fillWidth, 4);
        u8g2.sendBuffer();
      }
    }
  });

  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("[OTA] Error[%u]: ", error);
    const char* errStr = "OTA Error";
    if (error == OTA_AUTH_ERROR) errStr = "OTA Auth Failed";
    else if (error == OTA_BEGIN_ERROR) errStr = "OTA Begin Failed";
    else if (error == OTA_CONNECT_ERROR) errStr = "OTA Connect Fail";
    else if (error == OTA_RECEIVE_ERROR) errStr = "OTA Receive Fail";
    else if (error == OTA_END_ERROR) errStr = "OTA End Failed";
    Serial.println(errStr);
    if (oledAvailable) {
      displayError(errStr);
    }
  });

  ArduinoOTA.begin();
  Serial.println("[OTA] ArduinoOTA service started. Hostname: esp32-attendance.local");
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
    Serial.print("IP address: ");
    Serial.println(WiFi.localIP());
    configTime(19800, 0, "pool.ntp.org", "time.google.com");
    setenv("TZ", "IST-5:30", 1);
    tzset();
    triggerInitialTimeSync();
    buzzerWifiConnected();
    displayWifiConnected(WiFi.localIP().toString().c_str());
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
// BIOMETRIC SENSOR TEMPLATE EXTRACTION & BACKUP
// ==========================================
bool extractFingerprintTemplate(uint16_t id, String& outHex) {
  uint8_t p = finger.loadModel(id);
  if (p != FINGERPRINT_OK) {
    Serial.printf("[TEMPLATE] Failed to load model for slot #%d (err: %d)\n", id, p);
    return false;
  }

  p = finger.getModel();
  if (p != FINGERPRINT_OK) {
    Serial.printf("[TEMPLATE] Failed to initiate getModel for slot #%d (err: %d)\n", id, p);
    return false;
  }

  uint8_t bytesReceived[534];
  memset(bytesReceived, 0xff, 534);

  uint32_t starttime = millis();
  int i = 0;
  while (i < 534 && (millis() - starttime) < 2500) {
    if (serialSensor.available()) {
      bytesReceived[i++] = serialSensor.read();
    }
  }

  if (i < 534) {
    Serial.printf("[TEMPLATE] Timed out or incomplete read (%d/534 bytes)\n", i);
    return false;
  }

  uint8_t fingerTemplate[512];
  memset(fingerTemplate, 0xff, 512);

  // Extract 2 data packets (256 bytes each)
  int uindx = 9, index = 0;
  memcpy(fingerTemplate + index, bytesReceived + uindx, 256);
  uindx += 256 + 2 + 9;
  index += 256;
  memcpy(fingerTemplate + index, bytesReceived + uindx, 256);

  outHex = "";
  outHex.reserve(1025);
  const char hexChars[] = "0123456789ABCDEF";
  for (int j = 0; j < 512; j++) {
    outHex += hexChars[(fingerTemplate[j] >> 4) & 0x0F];
    outHex += hexChars[fingerTemplate[j] & 0x0F];
  }

  return true;
}

bool backupTemplateToBackend(uint16_t slot) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[TEMPLATE] Cannot backup template: WiFi disconnected");
    return false;
  }
  String hexStr;
  if (!extractFingerprintTemplate(slot, hexStr)) {
    return false;
  }

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/biometric/template/save";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(5000);

  JsonDocument doc;
  doc["fingerprint_id"] = slot;
  doc["template_data"] = hexStr;
  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  http.end();
  if (code == 200 || code == 201) {
    Serial.printf("[TEMPLATE] Successfully backed up template for slot #%d to database!\n", slot);
    return true;
  } else {
    Serial.printf("[TEMPLATE] Backup to backend failed with HTTP %d\n", code);
    return false;
  }
}

// ==========================================
// OFFLINE QUEUE FLUSHER
// ==========================================
void processOfflineQueue() {
  if (WiFi.status() != WL_CONNECTED || isFlushingQueue) return;
  if (offlineQueueCount == 0) return;
  if (millis() - lastQueueFlushTime < 15000) return; // Flush attempt interval
  lastQueueFlushTime = millis();
  isFlushingQueue = true;

  Serial.printf("[QUEUE] Attempting to flush %d queued offline punch(es)...\n", offlineQueueCount);

  // Step 1: Try batch sync endpoint (/api/biometric/punch/offline-sync)
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/biometric/punch/offline-sync";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_KEY);
  http.setTimeout(HTTP_TIMEOUT_MS);

  JsonDocument doc;
  JsonArray arr = doc["punches"].to<JsonArray>();
  for (int i = 0; i < offlineQueueCount; i++) {
    JsonObject p = arr.add<JsonObject>();
    p["fingerprint_id"] = offlineQueue[i].slot;
    p["epoch"] = offlineQueue[i].epoch;
  }
  String reqBody;
  serializeJson(doc, reqBody);

  int httpCode = http.POST(reqBody);
  if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_CREATED) {
    Serial.printf("[QUEUE] Successfully synced %d offline punches!\n", offlineQueueCount);
    offlineQueueCount = 0;
    saveOfflineQueue();
    http.end();
    isFlushingQueue = false;
    return;
  }
  http.end();

  // Step 2: Fallback to individual punch POSTs if offline-sync returned 404
  if (httpCode == 404) {
    Serial.println("[QUEUE] offline-sync endpoint returned 404, falling back to individual punch POSTs...");
    int successCount = 0;
    for (int i = 0; i < offlineQueueCount; i++) {
      HTTPClient sHttp;
      String sUrl = String(SERVER_URL) + "/api/biometric/punch";
      sHttp.begin(sUrl);
      sHttp.addHeader("Content-Type", "application/json");
      sHttp.addHeader("X-API-Key", API_KEY);
      sHttp.setTimeout(3000);

      JsonDocument sDoc;
      sDoc["fingerprint_id"] = offlineQueue[i].slot;
      sDoc["epoch"] = offlineQueue[i].epoch;
      String sBody;
      serializeJson(sDoc, sBody);

      int sCode = sHttp.POST(sBody);
      sHttp.end();
      if (sCode > 0 && sCode < 400) {
        successCount++;
      } else {
        Serial.printf("[QUEUE] Fallback POST failed for slot %d (code: %d)\n", offlineQueue[i].slot, sCode);
        break; // Stop and retry remaining later
      }
    }
    if (successCount == offlineQueueCount) {
      Serial.printf("[QUEUE] Fallback flushed all %d punches.\n", successCount);
      offlineQueueCount = 0;
      saveOfflineQueue();
    } else if (successCount > 0) {
      int remaining = offlineQueueCount - successCount;
      for (int i = 0; i < remaining; i++) {
        offlineQueue[i] = offlineQueue[i + successCount];
      }
      offlineQueueCount = remaining;
      saveOfflineQueue();
      Serial.printf("[QUEUE] Fallback partially flushed %d punches, %d remaining.\n", successCount, remaining);
    }
  } else {
    Serial.printf("[QUEUE] Flush failed with HTTP %d. Retrying later.\n", httpCode);
  }

  isFlushingQueue = false;
}

// ==========================================
// HTTP POST (API REQUEST)
// ==========================================
void postPunch(uint16_t fingerprintId) {
  // Get current time for offline display & record
  time_t now;
  time(&now);
  uint32_t currentEpoch = (uint32_t)now;
  char currentTimeStr[6] = "";
  if (now > 1700000000) {
    struct tm tinfo;
    localtime_r(&now, &tinfo);
    strftime(currentTimeStr, sizeof(currentTimeStr), "%H:%M", &tinfo);
  }

  // If WiFi is disconnected, store to flash immediately!
  if (WiFi.status() != WL_CONNECTED) {
    const char* cName = getCachedUserName(fingerprintId);
    enqueueOfflinePunch(fingerprintId, currentEpoch);
    displayOfflineSaved(cName, fingerprintId, currentTimeStr);
    buzzerOfflineSaved();
    Serial.printf("[OFFLINE] No WiFi. Stored punch for Slot #%d (%s) at %s\n", fingerprintId, cName, currentTimeStr);
    displayRestoreTime = millis() + 3000;
    needsDisplayRestore = true;
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
  if (currentEpoch > 1700000000) {
    doc["epoch"] = currentEpoch;
  }
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
      bool isBirthday = resp["is_birthday"] | false;
      bool isAdmin = resp["is_admin"] | false;
      if (!isAdmin) {
        String n = name;
        n.toLowerCase();
        if (n.indexOf("joel") >= 0 || n.indexOf("albert") >= 0) {
          isAdmin = true;
        }
      }
      
      if (action == "check_in") {
        if (isBirthday) {
          displayBirthday(name.c_str());
          buzzerHappyBirthday();
          Serial.printf("HAPPY BIRTHDAY CHECK-IN: %s!\n", name.c_str());
          displayRestoreTime = millis() + 5000;
          needsDisplayRestore = true;
        } else {
          displayCheckIn(name.c_str(), timeStr.c_str(), fingerprintId, isAdmin);
          buzzerCheckIn();
          Serial.printf("CHECK-IN (%s): %s at %s\n", isAdmin ? "BOSS" : "USER", name.c_str(), timeStr.c_str());
        }
      } else if (action == "check_out") {
        String hours = resp["hours_worked"] | "";
        displayCheckOut(name.c_str(), timeStr.c_str(), hours.c_str(), isAdmin);
        buzzerCheckOut();
        Serial.printf("CHECK-OUT (%s): %s at %s (%s)\n", isAdmin ? "BOSS" : "USER", name.c_str(), timeStr.c_str(), hours.c_str());
      } else if (action == "already_completed") {
        displayAlreadyDone(name.c_str());
        buzzerAlreadyDone();
        Serial.printf("ALREADY DONE: %s\n", name.c_str());
      } else if (action == "deactivated") {
        displayError("ACCOUNT INACTIVE");
        buzzerNetworkError();
        Serial.printf("BLOCKED DEACTIVATED: %s\n", name.c_str());
        displayRestoreTime = millis() + 3000;
        needsDisplayRestore = true;
      } else if (action == "unknown") {
        displayRetry();
        buzzerUnknownFinger();
        Serial.println("Fingerprint not enrolled in system");
      } else if (httpCode >= 500) {
        // Server error -> Store offline!
        const char* cName = getCachedUserName(fingerprintId);
        enqueueOfflinePunch(fingerprintId, currentEpoch);
        displayOfflineSaved(cName, fingerprintId, currentTimeStr);
        buzzerOfflineSaved();
        Serial.printf("[OFFLINE] Server 500. Stored punch for Slot #%d (%s) at %s\n", fingerprintId, cName, currentTimeStr);
        displayRestoreTime = millis() + 3000;
        needsDisplayRestore = true;
      } else {
        displayError("Invalid Response");
        buzzerNetworkError();
        Serial.printf("Unknown action: %s\n", action.c_str());
      }
    } else {
      if (httpCode >= 500) {
        const char* cName = getCachedUserName(fingerprintId);
        enqueueOfflinePunch(fingerprintId, currentEpoch);
        displayOfflineSaved(cName, fingerprintId, currentTimeStr);
        buzzerOfflineSaved();
        Serial.printf("[OFFLINE] Server 500 parse err. Stored punch for Slot #%d (%s)\n", fingerprintId, cName);
        displayRestoreTime = millis() + 3000;
        needsDisplayRestore = true;
      } else {
        displayError("JSON Parse Err");
        buzzerNetworkError();
      }
    }
  } else {
    // Server is unreachable, connection failed, or timed out -> Store offline!
    const char* cName = getCachedUserName(fingerprintId);
    enqueueOfflinePunch(fingerprintId, currentEpoch);
    displayOfflineSaved(cName, fingerprintId, currentTimeStr);
    buzzerOfflineSaved();
    Serial.printf("[OFFLINE] Server unreachable (code %d). Stored punch for Slot #%d (%s) at %s\n", httpCode, fingerprintId, cName, currentTimeStr);
    displayRestoreTime = millis() + 3000;
    needsDisplayRestore = true;
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
  const char* headerKeys[] = { "Date" };
  http.collectHeaders(headerKeys, 1);

  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK) {
    if (http.hasHeader("Date")) {
      syncTimeFromHttpDate(http.header("Date"));
    }
    String payload = http.getString();
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, payload);
    if (!err) {
      if (doc.containsKey("epoch")) {
        setTimeEpoch(doc["epoch"].as<time_t>());
      }
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
      } else if (cmd == "backup_all_templates") {
        Serial.println("\n[CMD] Received backup_all_templates command from server!");
        for (int i = 0; i < userCacheCount; i++) {
          uint16_t s = userCache[i].slot;
          Serial.printf("[TEMPLATE BACKUP] Extracting slot #%d (%s)...\n", s, userCache[i].name);
          backupTemplateToBackend(s);
          delay(100);
        }
        Serial.println("[TEMPLATE BACKUP] All templates backed up to server.");
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
  } else if (cmdLine == "backup_all") {
    Serial.println("Backing up all enrolled templates to backend database...");
    for (int i = 0; i < userCacheCount; i++) {
      uint16_t slot = userCache[i].slot;
      Serial.printf("Backing up Slot #%d (%s)...\n", slot, userCache[i].name);
      backupTemplateToBackend(slot);
      delay(150);
    }
    Serial.println("All templates backed up!");
  } else if (cmdLine.startsWith("backup ")) {
    uint16_t slot = cmdLine.substring(7).toInt();
    if (slot > 0) {
      Serial.printf("Backing up template for slot %d...\n", slot);
      backupTemplateToBackend(slot);
    }
  } else {
    Serial.println("Commands: enroll <slot>, delete <slot>, list, clear, backup_all, backup <slot>");
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
              backupTemplateToBackend(enrollSlot);
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
// LOCAL DIAGNOSTICS & MANAGEMENT WEBSERVER
// ==========================================
void setupLocalServer() {
  localServer.on("/status", HTTP_GET, []() {
    JsonDocument doc;
    doc["status"] = "online";
    doc["device"] = "ESP32 Attendance Terminal";
    doc["ip"] = WiFi.localIP().toString();
    doc["rssi"] = WiFi.RSSI();
    doc["offline_queue_count"] = offlineQueueCount;
    doc["cached_users_count"] = userCacheCount;
    doc["uptime_sec"] = millis() / 1000;
    String res;
    serializeJson(doc, res);
    localServer.send(200, "application/json", res);
  });

  localServer.on("/", HTTP_GET, []() {
    JsonDocument doc;
    doc["status"] = "online";
    doc["device"] = "ESP32 Attendance Terminal";
    doc["ip"] = WiFi.localIP().toString();
    doc["rssi"] = WiFi.RSSI();
    doc["offline_queue_count"] = offlineQueueCount;
    doc["cached_users_count"] = userCacheCount;
    doc["uptime_sec"] = millis() / 1000;
    String res;
    serializeJson(doc, res);
    localServer.send(200, "application/json", res);
  });

  localServer.on("/queue", HTTP_GET, []() {
    JsonDocument doc;
    doc["count"] = offlineQueueCount;
    JsonArray arr = doc["punches"].to<JsonArray>();
    for (int i = 0; i < offlineQueueCount; i++) {
      JsonObject p = arr.add<JsonObject>();
      p["slot"] = offlineQueue[i].slot;
      p["epoch"] = offlineQueue[i].epoch;
      p["name"] = getCachedUserName(offlineQueue[i].slot);
    }
    String res;
    serializeJson(doc, res);
    localServer.send(200, "application/json", res);
  });

  localServer.on("/flush", HTTP_POST, []() {
    lastQueueFlushTime = 0;
    processOfflineQueue();
    localServer.send(200, "application/json", "{\"status\":\"flushing_triggered\"}");
  });

  localServer.on("/template", HTTP_GET, []() {
    if (!localServer.hasArg("slot")) {
      localServer.send(400, "application/json", "{\"error\":\"Missing slot parameter\"}");
      return;
    }
    uint16_t slot = localServer.arg("slot").toInt();
    String hexStr;
    if (extractFingerprintTemplate(slot, hexStr)) {
      JsonDocument doc;
      doc["slot"] = slot;
      doc["template"] = hexStr;
      String res;
      serializeJson(doc, res);
      localServer.send(200, "application/json", res);
    } else {
      localServer.send(500, "application/json", "{\"error\":\"Failed to extract template\"}");
    }
  });

  localServer.on("/backup-all-templates", HTTP_GET, []() {
    int backedUp = 0;
    JsonDocument doc;
    JsonArray arr = doc["results"].to<JsonArray>();
    for (int i = 0; i < userCacheCount; i++) {
      uint16_t s = userCache[i].slot;
      bool ok = backupTemplateToBackend(s);
      JsonObject item = arr.add<JsonObject>();
      item["slot"] = s;
      item["name"] = userCache[i].name;
      item["backed_up"] = ok;
      if (ok) backedUp++;
      delay(100);
    }
    doc["total"] = userCacheCount;
    doc["success_count"] = backedUp;
    String res;
    serializeJson(doc, res);
    localServer.send(200, "application/json", res);
  });

  localServer.begin();
  Serial.println("[HTTP] Local management webserver started on port 80");
}

// ==========================================
// ARDUINO LIFECYCLE
// ==========================================
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BUZZER, OUTPUT);
  loadOfflineQueue();
  
  setupOLED();
  displayConnecting();
  setupWifi();
  if (WiFi.status() == WL_CONNECTED) {
    fetchAndCacheUsers();
    setupLocalServer();
  }
  setupOTA();
  setupFingerprint();
  
  displayIdle();
  Serial.println("===============================");
  Serial.println("Attendance System Initialized");
  Serial.println("Commands: enroll <slot>, delete <slot>, list, clear, backup_all, backup <slot>");
  Serial.println("===============================");
}

void loop() {
  ArduinoOTA.handle();
  processSerialCommands();
  localServer.handleClient();
  
  if (enrollState != IDLE) {
    handleEnrollment();
    delay(50);
    return; // Skip normal operations while in enrollment flow
  }

  checkWifi();
  pollBackendCommands();
  processOfflineQueue();

  // Periodically refresh user cache every 1 hour (or when connected and cache empty)
  if (WiFi.status() == WL_CONNECTED && (millis() - lastUserCacheFetch > 3600000 || userCacheCount == 0)) {
    fetchAndCacheUsers();
  }

  // Refresh idle clock every 1 second when in IDLE
  static unsigned long lastClockTick = 0;
  if (enrollState == IDLE && !needsDisplayRestore) {
    if (millis() - lastClockTick >= 1000) {
      lastClockTick = millis();
      displayIdleClock();
    }
  }

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
      displayRetry();
      lastScanTime = millis();
      displayRestoreTime = millis() + 2000;
      needsDisplayRestore = true;
    }
  }
  
  delay(50); // Small delay to prevent CPU hogging
}

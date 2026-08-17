#ifndef CONFIG_H
#define CONFIG_H

// Wi-Fi Configuration
#define WIFI_SSID       "Pauly Jr Pictures GF"
#define WIFI_PASSWORD   "Paulyjr@11"

// Backend Server
#define SERVER_URL      "http://192.168.1.60:4000"
#define API_KEY         "pluto-bio-2026"

// Hardware Pins
#define PIN_BUZZER      14
#define PIN_FP_RX       16   // ESP32 RX2 ← Sensor TX
#define PIN_FP_TX       17   // ESP32 TX2 → Sensor RX
#define PIN_SDA         21
#define PIN_SCL         22

// Timing
#define WIFI_TIMEOUT_MS     10000
#define HTTP_TIMEOUT_MS     5000
#define SCAN_COOLDOWN_MS    3000   // Prevent rapid re-scans
#define WIFI_RETRY_INTERVAL 15000  // Retry WiFi every 15s
#define POLL_INTERVAL_MS    2000   // Poll backend for web commands every 2s

#endif

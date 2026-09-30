# ESP32 Biometric Attendance Device Firmware

Firmware for the ESP32-based biometric punch terminal. It integrates an optical fingerprint sensor, an I2C OLED display (with center-aligned typography), an auditory piezo buzzer, backend REST API synchronization, and wireless Over-The-Air (OTA) flashing.

---

## ⚡ Hardware Pinout & Wiring

| Peripheral | Signal | ESP32 GPIO | Color / Notes |
|---|---|---|---|
| **Fingerprint Sensor** | RX (Yellow/White) | `GPIO 17` (TX2) | Serial2 Transmit to Fingerprint Sensor RX |
| **Fingerprint Sensor** | TX (Green) | `GPIO 16` (RX2) | Serial2 Receive from Fingerprint Sensor TX |
| **Fingerprint Sensor** | VCC | `5V` (or 3.3V) | Sensor power pin |
| **Fingerprint Sensor** | GND | `GND` | Common Ground |
| **OLED (SH1106 / SSD1306)** | SDA | `GPIO 21` | Hardware I2C Data line |
| **OLED (SH1106 / SSD1306)** | SCL | `GPIO 22` | Hardware I2C Clock line |
| **OLED** | VCC & GND | `3.3V` / `GND` | Display power |
| **Piezo Buzzer** | (+) Signal | `GPIO 14` | Driven via PWM/`tone()` |
| **Piezo Buzzer** | (-) Ground | `GND` | Ground |

---

## 🚀 Features

- **Center-Aligned OLED UI**: All screens (Idle, Scanning, Check-In, Check-Out, Error, and Enrollment) use dynamic text measurement (`u8g2.getStrWidth()`) to ensure centered layout on 128×64 displays.
- **Biometric Matching & Cloud Sync**: Verifies fingerprints locally with the optical sensor and posts attendance punches to the backend API (`/api/biometric/punch`).
- **Web & Serial Remote Enrollment**: Allows adding new employee fingerprints either directly via USB serial or remotely via the web dashboard.
- **Audio Feedback**: Distinctive audio tones for check-in, check-out, already completed, unknown fingerprint, Wi-Fi errors, and enrollment steps.
- **Over-The-Air (OTA) Updates**: Upload new code wirelessly via Wi-Fi with an animated progress bar and automatic reboot.

---

## 📡 Wireless Programming (ArduinoOTA)

### Overview
The firmware is configured with dual OTA flash partitions (`min_spiffs.csv`), allocating ~1.9 MB per application partition. It listens on the local Wi-Fi network using the hostname:
```text
esp32-attendance.local
```

### Display Indicators
- **Booting:** Shows `WiFi Connected`, its assigned local IP address, and `OTA Ready`.
- **Flashing in Progress:** Shows an animated loading bar with live percentage and a warning: `Do not unplug!`.
- **Completion:** Shows `OTA Success!` and automatically reboots into the new firmware.

### How to Flash Wirelessly

In PlatformIO, run:
```bash
pio run -e esp32dev-ota -t upload
```

#### If mDNS is not supported by your router:
Check the IP address shown on the OLED display at boot, open `platformio.ini`, and set `upload_port`:
```ini
[env:esp32dev-ota]
upload_port = 192.168.1.xxx
```

---

## 🔌 USB Flashing (Fallback / Initial Setup)

To flash over USB (e.g. on `COM3`):
```bash
pio run -e esp32dev -t upload
```

To monitor serial output:
```bash
pio device monitor -b 115200
```

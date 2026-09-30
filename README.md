# Attendance Tracker Dashboard

A modern, responsive, mobile-first web application designed to track employee attendance, manage leave requests, and configure optional/public holidays. Built entirely with Vanilla HTML, CSS, and JavaScript without frameworks, showcasing a premium glassmorphic UI.

## 🚀 Live Local Demo
To run the project locally, serve the directory using any static web server:
```bash
npx serve . -l 3000
```
Then open `http://localhost:3000`.

## 🏗️ Architecture & Tech Stack
- **Frontend Core**: Vanilla HTML5, CSS3, ES6 JavaScript.
- **Styling**: Custom CSS pipeline utilizing CSS Variables, Flexbox/Grid, and an advanced Glassmorphism design system. Fully responsive (mobile app view for users, desktop layout for Super Admins).
- **Icons**: [Ionicons 7](https://ionic.io/ionicons)
- **Backend / Mock Database**: Browser `LocalStorage` (`js/store.js`). The app operates as a complete Single Page Application (SPA) natively out of the browser without needing a live backend server.

## 👥 User Roles & Features

### 1. Normal User (`user1` / `password`)
The daily team member interface, heavily optimized for mobile usage.
- **Check-In/Out System (Home Tab)**: A satisfying, single large button to mark daily attendance. Real-time clock and dynamic status indicators (Working vs Completed).
- **Leave Requests**: Users can apply for Casual, Sick, or Earned leaves. Includes a localized history feed indicating pending/approved statuses.
- **Holiday Quotas (Optional Holidays)**:
  - Users have a fixed quota (default: 3) for choosing "Optional Holidays" from a pool determined by the Admin.
  - Users can click **Claim** to book a holiday, which auto-approves their leave.
  - **Constraints**: Users cannot claim holidays if their quota is 0, or if the holiday is less than 2 days away.

### 2. Super Admin (`admin1` / `password`)
The CRM and management dashboard for HR/Management. Expands to full-desktop width.
- **KPI Dashboard**: A top-level view showing "Present Today" vs total employees, and the number of unread Leave Requests.
- **Live Attendance Feed**: A dynamic table showing the exact check-in and check-out times of all users for the current day, along with whether they are on approved leave.
- **Leave Approvals Workflow**: A master queue of all pending leaves where Admins can Approve or Reject with one click.
- **User Management**: CRM table to add new users dynamically (automatically assigned default passwords) and remove users.
- **Holiday Management (Public vs Optional)**: 
  - Add or delete official company holidays.
  - Configurable toggle to decide if a holiday is a Mandatory "Public" holiday or an "Optional" unrestricted holiday for employees to claim.

## 📁 Project Structure
```text
/
├── index.html       # The main entry document housing both User and Admin views
├── css/
│   ├── style.css    # Core design system, variables, animations, and normal user UI
│   └── admin.css    # Desktop-scale grid layouts for the Admin panel
├── js/
│   ├── store.js     # The mock database layer (LocalStorage Wrapper)
│   ├── auth.js      # Session management and login logic
│   ├── app.js       # Normal User View Logic and SPA routing
│   └── admin.js     # Super Admin UI controllers and dashboard rendering
├── backend/         # Express & PostgreSQL API microservice
├── mcp-server/      # Model Context Protocol (MCP) server for AI agents
├── firmware/        # ESP32 Biometric Device Firmware & tools
│   └── esp32_attendance/
│       ├── platformio.ini  # PlatformIO build & OTA configuration
│       └── src/
│           ├── main.cpp    # Hardware loop, OLED, Fingerprint & OTA
│           └── config.h    # Wi-Fi, Pinouts & Server URL settings
└── README.md        # Project documentation
```

---

## 📟 Hardware: ESP32 Biometric Terminal

The system includes a dedicated ESP32-based biometric punch terminal that synchronizes in real time with the backend attendance API.

### Hardware Components & Pinout
| Component | Interface / Pin | ESP32 GPIO | Description |
|---|---|---|---|
| **OLED Display** | I2C SDA | **GPIO 21** | SH1106 / SSD1306 128×64 OLED |
| **OLED Display** | I2C SCL | **GPIO 22** | Center-aligned typography (U8g2) |
| **Fingerprint Sensor** | UART RX (Green) | **GPIO 16** | Connects to Sensor TX (Serial2) |
| **Fingerprint Sensor** | UART TX (White) | **GPIO 17** | Connects to Sensor RX (Serial2) |
| **Piezo Buzzer** | Digital Output | **GPIO 14** | Auditory chimes & feedback tones |
| **Power** | 5V / GND | **VIN / GND** | Micro-USB or external 5V power supply |

---

## 📡 Wireless Programming & Over-The-Air (OTA) Updates

The ESP32 firmware includes **ArduinoOTA** support, allowing you to update and flash firmware completely over Wi-Fi without needing a physical USB connection.

### How OTA Works
1. **Dual Application Partitions (`min_spiffs.csv`)**:
   The ESP32 flash is divided into two ~1.9 MB partitions (`ota_0` and `ota_1`). When flashing wirelessly, the new firmware is downloaded safely into the inactive partition. If successful, the bootloader switches to it upon reboot.
2. **Local Network Discovery (mDNS)**:
   The device announces itself on your Wi-Fi network as:
   ```text
   esp32-attendance.local
   ```
3. **On-Screen Visual Progress**:
   - **Boot:** The OLED screen displays `WiFi Connected`, its assigned IP address, and `OTA Ready`.
   - **During Upload:** The OLED displays an animated progress bar with live percentage (`0% - 100%`) and a `"Do not unplug!"` safety warning.

### Flashing Over Wi-Fi

#### Step 1: Ensure ESP32 is Powered & Connected to Wi-Fi
Power the ESP32 using any standard 5V USB charger or battery bank within your Wi-Fi coverage. Note the IP address displayed on the OLED screen.

#### Step 2: Push Update via PlatformIO
Run the following command from the `firmware/esp32_attendance` directory:
```bash
# Upload wirelessly using mDNS
pio run -e esp32dev-ota -t upload
```

> **Tip (Direct IP):** If your local network router or Windows firewall restricts mDNS resolution, specify the IP address directly in `firmware/esp32_attendance/platformio.ini`:
> ```ini
> [env:esp32dev-ota]
> upload_port = 192.168.1.xxx   ; Replace with ESP32 IP shown on OLED
> ```

#### Step 3 (Fallback): Flashing via USB Cable
To flash via USB (e.g. for initial setup or partition table modifications):
```bash
pio run -e esp32dev -t upload
```


#include <Arduino.h>
#include <Wire.h>
#include <U8g2lib.h>

#define PIN_SDA 21
#define PIN_SCL 22
#define PIN_BUZZER 14

// Try EVERY known 128x64 OLED driver in sequence
// Some clone modules don't ACK during scan but still accept commands

void beep(int freq, int ms) {
  tone(PIN_BUZZER, freq, ms);
  delay(ms);
  noTone(PIN_BUZZER);
}

// Raw I2C command sender - ignores ACK failures
void sendRawOLEDInit(uint8_t addr) {
  Serial.printf("Force-sending SSD1306 init sequence to 0x%02X...\n", addr);
  
  // SSD1306 initialization sequence
  uint8_t initCmds[] = {
    0xAE,       // Display OFF
    0xD5, 0x80, // Set display clock
    0xA8, 0x3F, // Set multiplex ratio (64-1)
    0xD3, 0x00, // Set display offset
    0x40,       // Set start line
    0x8D, 0x14, // Charge pump ON (for 3.3V/5V internal)
    0x20, 0x00, // Horizontal addressing mode
    0xA1,       // Segment remap
    0xC8,       // COM output scan direction
    0xDA, 0x12, // COM pins config
    0x81, 0xFF, // Set contrast to MAX
    0xD9, 0xF1, // Pre-charge period
    0xDB, 0x40, // VCOMH deselect level
    0xA4,       // Display from RAM
    0xA6,       // Normal display (not inverted)
    0xAF        // Display ON
  };
  
  Wire.beginTransmission(addr);
  Wire.write(0x00); // Command stream
  for (uint8_t cmd : initCmds) {
    Wire.write(cmd);
  }
  Wire.endTransmission();
  
  // Fill entire display with white pixels
  for (int page = 0; page < 8; page++) {
    Wire.beginTransmission(addr);
    Wire.write(0x00); // Command
    Wire.write(0xB0 + page); // Set page
    Wire.write(0x00); // Lower column
    Wire.write(0x10); // Upper column
    Wire.endTransmission();
    
    // Send 128 bytes of 0xFF (all pixels ON)
    for (int seg = 0; seg < 128; seg += 16) {
      Wire.beginTransmission(addr);
      Wire.write(0x40); // Data stream
      for (int b = 0; b < 16; b++) {
        Wire.write(0xFF);
      }
      Wire.endTransmission();
    }
  }
  Serial.println("  Sent full white screen data.");
  
  // Also try SH1106 column offset (SH1106 uses column offset of 2)
  Serial.printf("Force-sending SH1106 init sequence to 0x%02X...\n", addr);
  Wire.beginTransmission(addr);
  Wire.write(0x00);
  Wire.write(0xAE); // OFF
  Wire.write(0xD5); Wire.write(0x80);
  Wire.write(0xA8); Wire.write(0x3F);
  Wire.write(0xD3); Wire.write(0x00);
  Wire.write(0x40);
  Wire.write(0xAD); Wire.write(0x8B); // SH1106 charge pump
  Wire.write(0xA1);
  Wire.write(0xC8);
  Wire.write(0xDA); Wire.write(0x12);
  Wire.write(0x81); Wire.write(0xFF);
  Wire.write(0xD9); Wire.write(0x1F);
  Wire.write(0xDB); Wire.write(0x40);
  Wire.write(0xA4);
  Wire.write(0xA6);
  Wire.write(0xAF); // ON
  Wire.endTransmission();
  
  // SH1106 page writes with column offset 2
  for (int page = 0; page < 8; page++) {
    Wire.beginTransmission(addr);
    Wire.write(0x00);
    Wire.write(0xB0 + page);
    Wire.write(0x02); // SH1106 lower col = 2
    Wire.write(0x10); // Upper col = 0
    Wire.endTransmission();
    
    for (int seg = 0; seg < 128; seg += 16) {
      Wire.beginTransmission(addr);
      Wire.write(0x40);
      for (int b = 0; b < 16; b++) {
        Wire.write(0xFF);
      }
      Wire.endTransmission();
    }
  }
  Serial.println("  Sent SH1106 full white screen data.");
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=======================================================");
  Serial.println("     BRUTE FORCE OLED DISPLAY ACTIVATOR               ");
  Serial.println("=======================================================");
  
  beep(2000, 100);

  // Phase 1: Force raw commands via Wire library
  Serial.println("\n[PHASE 1] Force-sending raw init commands via Wire (ignoring ACK)...");
  Wire.begin(PIN_SDA, PIN_SCL, 100000);
  sendRawOLEDInit(0x3C);
  delay(500);
  sendRawOLEDInit(0x3D);
  delay(500);
  
  // Phase 2: Try U8g2 SSD1306 (it initializes regardless)
  Serial.println("\n[PHASE 2] U8g2 SSD1306 Hardware I2C on (21,22)...");
  {
    U8G2_SSD1306_128X64_NONAME_F_HW_I2C d(U8G2_R0, U8X8_PIN_NONE, PIN_SCL, PIN_SDA);
    d.setI2CAddress(0x3C * 2);
    d.begin();
    d.setContrast(255);
    d.clearBuffer();
    d.drawBox(0, 0, 128, 64); // Full white
    d.sendBuffer();
    delay(1000);
    d.clearBuffer();
    d.drawFrame(0, 0, 128, 64);
    d.setFont(u8g2_font_helvB08_tf);
    d.drawStr(20, 30, "SSD1306 0x3C");
    d.sendBuffer();
  }
  delay(500);
  
  // Phase 3: Try U8g2 SH1106
  Serial.println("\n[PHASE 3] U8g2 SH1106 Hardware I2C on (21,22)...");
  {
    U8G2_SH1106_128X64_NONAME_F_HW_I2C d(U8G2_R0, U8X8_PIN_NONE, PIN_SCL, PIN_SDA);
    d.setI2CAddress(0x3C * 2);
    d.begin();
    d.setContrast(255);
    d.clearBuffer();
    d.drawBox(0, 0, 128, 64);
    d.sendBuffer();
    delay(1000);
    d.clearBuffer();
    d.drawFrame(0, 0, 128, 64);
    d.setFont(u8g2_font_helvB08_tf);
    d.drawStr(20, 30, "SH1106 0x3C");
    d.sendBuffer();
  }
  delay(500);
  
  // Phase 4: Try Software I2C (bypasses hardware I2C peripheral entirely)
  Serial.println("\n[PHASE 4] Software Bit-Bang SSD1306...");
  {
    U8G2_SSD1306_128X64_NONAME_F_SW_I2C d(U8G2_R0, PIN_SCL, PIN_SDA, U8X8_PIN_NONE);
    d.setI2CAddress(0x3C * 2);
    d.begin();
    d.setContrast(255);
    d.clearBuffer();
    d.drawBox(0, 0, 128, 64);
    d.sendBuffer();
  }
  delay(500);
  
  Serial.println("\n[PHASE 5] Software Bit-Bang SH1106...");
  {
    U8G2_SH1106_128X64_NONAME_F_SW_I2C d(U8G2_R0, PIN_SCL, PIN_SDA, U8X8_PIN_NONE);
    d.setI2CAddress(0x3C * 2);
    d.begin();
    d.setContrast(255);
    d.clearBuffer();
    d.drawBox(0, 0, 128, 64);
    d.sendBuffer();
  }
  delay(500);

  // Phase 6: Try 0x3D address
  Serial.println("\n[PHASE 6] Trying address 0x3D on all drivers...");
  {
    U8G2_SSD1306_128X64_NONAME_F_SW_I2C d(U8G2_R0, PIN_SCL, PIN_SDA, U8X8_PIN_NONE);
    d.setI2CAddress(0x3D * 2);
    d.begin();
    d.setContrast(255);
    d.clearBuffer();
    d.drawBox(0, 0, 128, 64);
    d.sendBuffer();
  }
  {
    U8G2_SH1106_128X64_NONAME_F_SW_I2C d(U8G2_R0, PIN_SCL, PIN_SDA, U8X8_PIN_NONE);
    d.setI2CAddress(0x3D * 2);
    d.begin();
    d.setContrast(255);
    d.clearBuffer();
    d.drawBox(0, 0, 128, 64);
    d.sendBuffer();
  }

  Serial.println("\n=======================================================");
  Serial.println("All phases complete. Check if ANYTHING appeared on the");
  Serial.println("OLED screen (even a brief flash of white pixels).");
  Serial.println("=======================================================");
  
  beep(1800, 80);
  delay(40);
  beep(2400, 120);
}

void loop() {
  delay(1000);
}

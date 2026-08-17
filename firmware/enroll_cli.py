import serial
import time
import sys

PORT = 'COM3'
BAUD = 115200

def run_interactive_enrollment():
    try:
        s = serial.Serial(PORT, BAUD, timeout=0.1)
        print("=" * 60)
        print("  ESP32 BIOMETRIC ENROLLMENT & DIAGNOSTIC TOOL")
        print("=" * 60)
        print("Connected to", PORT)
        print("Commands: enroll <slot_num> | delete <slot_num> | list | clear | exit")
        print("-" * 60)

        # Flush startup garbage
        time.sleep(0.5)
        while s.in_waiting:
            s.read(s.in_waiting)

        while True:
            # Check for incoming serial logs
            if s.in_waiting:
                data = s.read(s.in_waiting).decode('utf-8', errors='replace')
                print(data, end='', flush=True)

            cmd = input("\nEnter command (e.g. 'enroll 1', 'list', 'exit'): ").strip()
            if not cmd:
                continue
            if cmd.lower() == 'exit':
                break

            s.write((cmd + '\n').encode('utf-8'))
            print(f">>> Sent: {cmd}\n>>> Follow buzzer / terminal prompts...")
            
            # Listen to serial output during enrollment or scan
            start = time.time()
            timeout = 25 if cmd.startswith('enroll') else 4
            while time.time() - start < timeout:
                if s.in_waiting:
                    data = s.read(s.in_waiting).decode('utf-8', errors='replace')
                    print(data, end='', flush=True)
                    if "SUCCESS" in data or "failed" in data or "Templates stored" in data or "Database cleared" in data:
                        time.sleep(0.5)
                        break
                time.sleep(0.05)

        s.close()
        print("\nSession ended.")
    except Exception as e:
        print("Serial error:", e)

if __name__ == '__main__':
    run_interactive_enrollment()

import serial
import time

try:
    s = serial.Serial('COM3', 115200, timeout=0.1)
    print(">>> LIVE SERIAL MONITOR ACTIVE (Place your finger on the sensor to test)...")
    start = time.time()
    while time.time() - start < 12:
        if s.in_waiting:
            data = s.read(s.in_waiting).decode('utf-8', errors='replace')
            print(data, end='', flush=True)
        time.sleep(0.05)
    s.close()
    print("\n>>> Monitor session ended.")
except Exception as e:
    print("Serial error:", e)

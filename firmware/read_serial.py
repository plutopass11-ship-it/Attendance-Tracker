import serial
import time

try:
    s = serial.Serial('COM3', 115200, timeout=1)
    # Toggle DTR/RTS to reboot ESP32 cleanly to get full boot diagnostics
    s.dtr = False
    s.rts = True
    time.sleep(0.1)
    s.rts = False
    time.sleep(0.5)

    start = time.time()
    while time.time() - start < 15:
        if s.in_waiting:
            line = s.read(s.in_waiting).decode('utf-8', errors='replace')
            print(line, end='', flush=True)
        time.sleep(0.05)
    s.close()
except Exception as e:
    print("Serial error:", e)

import serial
import time

s = serial.Serial('COM3', 115200, timeout=0.1)
s.dtr = False
s.rts = False

print("Listening for boot output (16s)...")
start = time.time()
while time.time() - start < 16:
    if s.in_waiting:
        line = s.read(s.in_waiting).decode('utf-8', errors='replace')
        print(line, end='', flush=True)
    time.sleep(0.05)

print("\n>>> Sending 'list' command...")
s.write(b"list\n")
time.sleep(1)
while s.in_waiting:
    line = s.read(s.in_waiting).decode('utf-8', errors='replace')
    print(line, end='', flush=True)

s.close()

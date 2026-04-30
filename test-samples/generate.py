"""
Generates synthetic .wav test files for each open guitar string.
Each file is a 1-second sine wave at the string's fundamental frequency.

Real guitar strings have overtones/harmonics on top of the fundamental,
so a pure sine wave is an easier target than real guitar audio. That's fine
for unit-testing the algorithm — real audio comes later via the microphone.
"""

import wave
import struct
import math
import os

SAMPLE_RATE = 44100
DURATION = 1.0          # seconds
AMPLITUDE = 0.8         # 0.0–1.0 (leave headroom to avoid clipping)

# Open string tuning: name → fundamental frequency in Hz
STRINGS = {
    "E2": 82.41,   # 6th string (thickest)
    "A2": 110.00,  # 5th string
    "D3": 146.83,  # 4th string
    "G3": 196.00,  # 3rd string
    "B3": 246.94,  # 2nd string
    "E4": 329.63,  # 1st string (thinnest)
}

output_dir = os.path.dirname(os.path.abspath(__file__))

for note_name, freq in STRINGS.items():
    filename = os.path.join(output_dir, f"{note_name}.wav")
    num_samples = int(SAMPLE_RATE * DURATION)

    with wave.open(filename, "w") as wav:
        wav.setnchannels(1)       # mono
        wav.setsampwidth(2)       # 16-bit (2 bytes per sample)
        wav.setframerate(SAMPLE_RATE)

        for i in range(num_samples):
            t = i / SAMPLE_RATE
            # Pure sine wave: value oscillates between -1 and 1 at `freq` Hz
            sample = AMPLITUDE * math.sin(2 * math.pi * freq * t)
            # Scale to 16-bit integer range (-32768 to 32767) and pack as binary
            packed = struct.pack("<h", int(sample * 32767))
            wav.writeframes(packed)

    print(f"Generated {note_name}.wav  ({freq} Hz)")

print("\nDone. All 6 open string files written.")

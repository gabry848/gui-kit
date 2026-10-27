# Minimal repro: transmit a zlib-compressed RGBA image (kitty graphics o=z).
# usage: python3 ghostty-zlib-crash.py WIDTH HEIGHT LOGFILE [solid|noise] [t|T]
# noise: random RGB, opaque. T: also show it (a=T, virtual placement U=1).
import base64, os, random, sys, time, zlib

w, h, log = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
content = sys.argv[4] if len(sys.argv) > 4 else 'solid'
action = sys.argv[5] if len(sys.argv) > 5 else 't'
tag = f'{w}x{h}-{os.path.basename(content)}-{action}'
def note(line):
    with open(log, 'a') as f:
        f.write(f'{tag} {line}\n'); f.flush(); os.fsync(f.fileno())

if content.startswith('file:'):
    # A precompressed zlib stream of a WIDTH x HEIGHT RGBA image.
    compressed = open(content[5:], 'rb').read()
elif content == 'noise':
    random.seed(1)
    raw = bytearray(random.randbytes(w * h * 4))
    raw[3::4] = b'\xff' * (w * h)
else:
    raw = bytes([200, 100, 50, 255]) * (w * h)
if not content.startswith('file:'):
    compressed = zlib.compress(bytes(raw), 1)
payload = base64.b64encode(compressed).decode()
chunks = [payload[i:i + 4096] for i in range(0, len(payload), 4096)]
seq = ''
for i, chunk in enumerate(chunks):
    more = 1 if i < len(chunks) - 1 else 0
    show = ',U=1,c=20,r=5' if action == 'T' else ''
    head = f'a={action},f=32,o=z,s={w},v={h},i=1,q=2{show},m={more}' if i == 0 else f'm={more}'
    seq += f'\033_G{head};{chunk}\033\\'
note(f'begin: {len(compressed)} bytes compressed, {len(payload)} base64, {len(chunks)} chunks')
sys.stdout.write(seq); sys.stdout.flush()
time.sleep(3)
note('ok')

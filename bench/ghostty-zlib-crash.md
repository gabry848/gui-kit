# Ghostty crashes on a valid zlib stream in kitty graphics (o=z)

Draft bug report for Ghostty. Not filed yet.

## Summary

Ghostty 1.3.1 on macOS crashes (fatal, the whole app with every window) when a program transmits a kitty graphics image with `f=32,o=z` and certain valid zlib streams as payload. Two zlib streams of the same 400×200 RGBA image behave differently: the one from Python's `zlib.compress(data, 1)` is fine, the one from Bun's `node:zlib` `deflateSync(data, {level: 1})` crashes Ghostty. Both decompress to identical bytes with Python's zlib.

## Environment

- Ghostty 1.3.1 (ReleaseFast, Metal renderer, CoreText font backend)
- macOS 26.6.2 (25G83), Apple Silicon
- Producer of the crashing stream: Bun 1.3.14 `node:zlib`

## Steps to reproduce

1. Open a Ghostty window you can afford to lose. A separate instance keeps your other windows safe: `open -na Ghostty.app --args --window-save-state=never`.
2. Run:

   ```sh
   python3 bench/ghostty-zlib-crash.py 400 200 /tmp/zlib.log file:bench/fixtures/ghostty-crash-400x200.rgba.z t
   ```

   This sends `ESC _G a=t,f=32,o=z,s=400,v=200,i=1,q=2,m=… ; <base64> ESC \` in 4096-byte chunks.
3. Ghostty crashes right away, and `/tmp/zlib.log` never gets its `ok` line.
4. Control: the same command with `bench/fixtures/ghostty-ok-400x200.rgba.z` survives.

## Fixtures

| File | Producer | Size | SHA-256 |
|---|---|---|---|
| `ghostty-crash-400x200.rgba.z` | Bun `deflateSync`, level 1 | 4,592 B | `2fcda972fd0bac87d1786664bc0a7d4960e8b3f7d5947d795bcb6cc3534b867e` |
| `ghostty-ok-400x200.rgba.z` | Python `zlib.compress`, level 1 | 2,784 B | `a71d7feefd9ef4f598ee37aee9ed0539780117c369af022eccbee1a28d4d2154` |

Both inflate to the same 320,000 bytes (400×200 RGBA).

## What we measured

Each variant ran in its own Ghostty instance (`bench/kitty-crash-variants.ts`):

| Variant | Result |
|---|---|
| 400×200 RGBA, Bun zlib (`o=z`), chunked or in one command, with or without placeholders | crash |
| 20×20 RGBA, Bun zlib (`o=z`), even split in 64-byte chunks | ok |
| 400×200 RGBA, uncompressed | ok |
| 2300×1400 RGBA, uncompressed, 230×70 Unicode placeholders | ok |
| 400×200 and 2300×1400 PNG (`f=100`), 4096-byte chunks, placeholders | ok |
| Python zlib, 64×64 up to 1024×1024, solid color or random noise, `a=t` or `a=T,U=1` | ok |
| Full-screen PNG redrawn 180 times at 30 fps (`bench/kitty-stress.ts`) | ok |

A crash report was written for each crash (`~/.local/state/ghostty/crash/*.ghosttycrash`, sentry-native minidumps). Expected behavior: decode the image, or reply with an error such as `EINVAL: decompression failed`, without crashing.

## Workaround in gui-kit

The kit sends PNG (`f=100`) instead of `o=z`, see `kittyTransmit` in `src/kit/canvas/encode.ts`.

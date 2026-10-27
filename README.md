# gui-kit

A kit for full-screen terminal apps built on [Ink](https://github.com/vadimdemedes/ink) 8, meant to be written by agents as well as people. Every app gets the same shell, Vim-style keys, mouse support and a canvas, and runs in any terminal (Ghostty, tmux, ssh). This is a phase-0 spike that tests whether Ink can carry complete apps.

## What the spike covers

- **Shell:** full screen, a status line with the current mode, a `:` command line, a which-key popup for multi-key sequences, and `?` help generated from the bindings.
- **Keys:** a Vim-style engine (`src/kit/keymap.ts`) with modes, counts (`5j`), sequences (`gg`, `dd`, `<Space>1`), layered bindings and modal layers.
- **Mouse:** SGR reports, in pixels where the terminal supports DEC 1016. Ink 8 drops mouse reports, so `InputSplitter` takes them out of stdin before Ink reads it.
- **Canvas:** a vector scene rasterized per frame, then drawn as braille (2×4 dots per cell) or half blocks (1×2 pixels). Both are plain text and work everywhere. The kitty pixel mode (Unicode placeholders) is opt-in, see below.
- **Probe:** asks the terminal what it supports (kitty graphics and keyboard, pixel mouse, synchronized output, cell size) before Ink starts.
- **Headless testing:** `src/kit/testing.tsx` runs an app inside xterm.js headless, so tests and agents can type keys, click and read the screen.

## Known issues

- On 2026-10-27, Ghostty 1.3.1 crashed when the demo canvas ran in kitty mode, and the cause is not isolated yet. Kitty mode is off unless you set `GUI_GRAPHICS=kitty`.

## Development

```sh
bun install
bun run demo        # the spike app: a list and a canvas
bun test            # headless tests in a virtual terminal
bun run typecheck
bun bench/canvas.ts 200 50   # frame cost per canvas backend
```

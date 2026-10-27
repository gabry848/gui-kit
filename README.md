# gui-kit

A kit and a CLI for full-screen terminal apps built on [Ink](https://github.com/vadimdemedes/ink) 8, meant to be written by agents as well as people. Every app gets the same shell, Vim-style keys, mouse support and a canvas. Apps run in any terminal (Ghostty, tmux, ssh) and take their terminal full screen: they never manage windows.

There are two kinds of app:

- **One-off:** a single `.tsx` file. `gui ask file.tsx` shows it and prints the value the app passes to `finish()` as JSON on stdout, so `answer=$(gui ask form.tsx)` works like fzf.
- **Saved:** a folder with `gui.json` and `app.tsx`, installed by name and started with `gui <name>`.

## CLI

```sh
gui <app> [args]                  # start an installed app
gui run <app|folder|file>         # start in the current terminal
gui ask <app|file>                # finish() value as JSON on stdout; exit 1 if cancelled
gui screen <app|file> --keys 'K'  # render in a virtual terminal, press keys (Vim notation), print the screen
gui check <app|folder|file>       # type check
gui new <name> [--dir D] [--from file.tsx] [--description T]
gui install [folder] [--bin]      # register by name; --bin also writes ~/.local/bin/<name>
gui uninstall <name>              # unregister; files stay
gui ls [--json]
```

Install the command with `ln -s "$PWD/bin/gui" ~/.local/bin/gui`. The registry lives in `~/.local/share/gui/registry.json` (`GUI_HOME` moves it).

## Writing an app

An app file default-exports its root component and imports everything from `'gui-kit'`, React hooks and Ink's `Box`/`Text` included. The CLI sets `NODE_PATH`, so this works from any folder with no install, and the app always shares the kit's React. See `examples/` and `skill/gui-apps/SKILL.md`.

```tsx
import {Select, Shell, useFinish} from 'gui-kit';

export default function App() {
	const finish = useFinish();
	return (
		<Shell title="Where?">
			<Select options={[{label: 'Ghostty', value: 'ghostty'}, {label: 'tmux', value: 'tmux'}]} onSelect={finish} />
		</Shell>
	);
}
```

## What the kit has

- **Shell:** a status line with the current mode, a `:` command line, a which-key popup for multi-key sequences, and `?` help generated from the bindings.
- **Keys:** a Vim-style engine (`src/kit/keymap.ts`) with modes, counts (`5j`), sequences (`gg`, `dd`, `<Space>1`), layered bindings and modal layers. When keys arrive in one chunk (fast typing, or an agent), they are fed one at a time, each after the previous render.
- **Components:** `List`, `Select`, `Table`, `Form`, `TextInput`, `Confirm`, `Modal`, `Canvas`.
- **Mouse:** SGR reports, in pixels where the terminal supports DEC 1016. Ink 8 drops mouse reports, so `InputSplitter` takes them out of stdin before Ink reads it.
- **Canvas:** a vector scene rasterized per frame, drawn as braille (2×4 dots per cell) or half blocks (1×2 pixels), which work everywhere. Kitty pixel graphics through Unicode placeholders are opt-in (`GUI_GRAPHICS=kitty`).
- **Probe:** before Ink starts, the kit asks the terminal what it supports: kitty graphics and keyboard, pixel mouse, synchronized output and cell size.
- **Headless testing:** `src/kit/testing.tsx` runs an app inside xterm.js headless; `gui screen` exposes it on the command line.

## Known issues

- Ghostty 1.3.1 crashes on some valid zlib payloads sent with `o=z` (see `bench/ghostty-zlib-crash.md`). The kit sends PNG instead, and a full-screen 30 fps stress test passes, but kitty mode stays opt-in for now.
- Under Bun, packages found through `NODE_PATH` ignore `package.json` `exports`, so the kit uses `main` and the `testing.ts` file for `gui-kit/testing`.

## Development

```sh
bun install
bun test                      # headless tests: keys, mouse, components, CLI
bun run typecheck
bun run demo                  # spike app: a list and a canvas
bun bench/canvas.ts 200 50    # frame cost per canvas backend
```

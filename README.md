# gui-kit

A kit and a CLI for full-screen terminal apps built on [Ink](https://github.com/vadimdemedes/ink) 8 and React, made to be written by AI agents as well as people. Every app gets the same shell, Vim-style keys, mouse support, components for large apps and a canvas. Apps run in any terminal (Ghostty, kitty, tmux, ssh) and take their terminal full screen: they never manage windows, so you arrange them with your terminal's own tabs and splits.

There are two kinds of app:

- **One-off:** a single `.tsx` file. `gui ask file.tsx` shows it and prints the value the app passes to `finish()` as JSON on stdout, so `answer=$(gui ask form.tsx)` works like fzf. `gui scratch` gives you a file to start from, and `gui gc` cleans up old ones.
- **Saved:** a folder with `gui.json` and `app.tsx`, installed by name and started with `gui <name>`. It runs on its own copy of the kit and, on macOS, inside a sandbox limited to the permissions you approved.

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

```sh
$ choice=$(gui ask where.tsx) && echo "$choice"
"ghostty"
```

## Install

Requires [Bun](https://bun.sh) 1.3 or later.

```sh
git clone https://github.com/Gabry848/gui-kit.git
cd gui-kit
bun install
ln -s "$PWD/bin/gui" ~/.local/bin/gui    # any folder on your PATH
gui help
```

Apps import `'gui-kit'` from any folder without installing anything: the CLI points them at the kit.

## CLI

```sh
gui <app> [args]                  # start an installed app
gui run <app|folder|file>         # start it in the current terminal
gui ask <app|folder|file>         # finish() value as JSON on stdout; exit 1 if cancelled, 3 without a terminal
gui screen <app|file> --keys 'K'  # render in a virtual terminal, press keys (Vim notation), print the screen
gui check <app|folder|file>       # type check and a first render, no terminal needed

gui scratch [name]                # new one-off file in ~/.local/share/gui/scratch; prints its path
gui keep <file> <name>            # turn a one-off file into a saved app and install it
gui new <name> [--dir D] [--from file.tsx] [--description T]
gui install [folder] [--bin] [--yes]   # register by name; --bin also writes ~/.local/bin/<name>
gui uninstall <name>              # unregister; files and data stay
gui ls [--json]                   # installed apps and one-off files
gui kits                          # saved kit versions and the apps on them
gui gc [--days N] [--dry-run]     # delete one-off files unused for N days and unused kit copies
```

Everything lives in `${XDG_DATA_HOME:-~/.local/share}/gui` (`GUI_HOME` moves it): the registry, kit copies, one-off files and each app's data folder.

## Saved apps: gui.json

```json
{
	"name": "notes",
	"description": "Notes for the current project",
	"entry": "app.tsx",
	"kit": "^0.1.0",
	"permissions": {"read": ["$CWD"], "write": ["$CWD/notes"], "run": ["git"], "net": false}
}
```

**Kit versions.** `"kit"` is the semver range of gui-kit versions the app works with. `gui install` copies the current kit to `GUI_HOME/kits/<version>` and links that copy into the project's `node_modules` (`gui-kit`, `react`, `@types`), so Bun, `tsc` and your editor all see the same kit, and later changes to the kit cannot break an installed app. Reinstall to move an app to a newer compatible copy; change `"kit"` to move it across an incompatible version.

**Permissions.** `"permissions"` says what the app may do beyond the baseline. The baseline (`{}`, what `gui new` writes) can read the app's own folder, its data folder, the kit and files outside your home; it can write its data folder, temp folders and the terminal; it has no network and runs no commands.

| Key | Value |
|---|---|
| `read` | Paths it may also read inside your home. |
| `write` | Paths it may also write (and read). |
| `net` | `false`, `"local"` (localhost only) or `true`. |
| `run` | Command names it may run, such as `git`, or `"*"` for any. Programs it starts stay in the sandbox. |

Paths may start with `$CWD` (the folder `gui` was started in), `$APP`, `$DATA`, `$HOME`, `$TMP` or `~`. An app without a `"permissions"` field has full access.

`gui install` lists what an app asks for and needs your yes; without a terminal it needs `--yes`, which an agent should pass only after you agreed. Reinstalling with the same permissions asks nothing; an app whose `gui.json` later asks for more stops until you approve it again.

On macOS the app runs inside `sandbox-exec` with a profile built from these permissions, and `gui screen` and `gui check` use the same sandbox. On other systems the permissions are shown and approved but not enforced. The app's data folder is in `GUI_DATA_DIR`.

## Writing an app

An app file default-exports its root component and imports everything from `'gui-kit'`, React hooks and Ink's `Box`/`Text` included, so it always shares the kit's React. Arguments arrive as a JSON array in `GUI_ARGS`. See [`skill/gui-apps/SKILL.md`](skill/gui-apps/SKILL.md) for the full guide (written for agents, useful for people), `examples/` for small apps and `apps/workbench` for a large one.

## What the kit has

- **Shell:** a status line with the current mode, a `:` command line, a which-key popup for multi-key sequences, `?` help generated from the bindings, and toast notifications (`useNotify`).
- **Keys:** a Vim-style engine (`src/kit/keymap.ts`) with modes, counts (`5j`), sequences (`gg`, `dd`, `<Space>1`), layered bindings and modal layers. When keys arrive in one chunk (fast typing, or an agent), they are fed one at a time, each after the previous render.
- **Components:** `List`, `Select`, `Table`, `Tree` (lazy children), `Pager` (100k lines, search, follow), `Tabs`, `Split` (panes with `Ctrl-w` focus), `Form`, `TextInput`, `Confirm`, `Modal`, `Spinner`, `ProgressBar`, `ProcessView` and `useProcess` (run a command and stream its output), `Image` and `Canvas`.
- **Mouse:** SGR reports, in pixels where the terminal supports DEC 1016. Ink 8 drops mouse reports, so `InputSplitter` takes them out of stdin before Ink reads it.
- **Graphics:** the canvas is a vector scene rasterized per frame, drawn as braille (2×4 dots per cell) or half blocks, which work everywhere. Kitty pixel graphics (PNG through Unicode placeholders) turn on by themselves in kitty and Ghostty 1.4+. Sixel is opt-in with `GUI_GRAPHICS=sixel`. `Image` shows PNG and JPEG files with the best of those. `GUI_GRAPHICS=none` forces text, `GUI_GRAPHICS=kitty` forces kitty where the terminal answers its query.
- **Probe:** before Ink starts, the kit asks the terminal what it supports: its name and version (XTVERSION), kitty graphics and keyboard, sixel, pixel mouse, synchronized output and cell size.
- **Headless testing:** `src/kit/testing.tsx` runs an app inside xterm.js headless; `gui screen` exposes it on the command line, so an agent can check an app without a terminal.

## The workbench app

`apps/workbench` is a complete app built with the kit: a dashboard for the folder you start it in, with tabs for files, git, tasks and ports. Install it with `gui install apps/workbench` and run `gui workbench` in any project.

## Known issues

- Ghostty 1.3.1 crashes on some valid zlib payloads sent with kitty `o=z` (see [`bench/ghostty-zlib-crash.md`](bench/ghostty-zlib-crash.md)); it is fixed on Ghostty's main branch for 1.4. The kit sends PNG instead, and kitty graphics stay opt-in on Ghostty 1.3.x.
- Sixel output is tested against a decoder, not yet in a real sixel terminal.
- Permissions are enforced only on macOS.
- Under Bun, packages found through `NODE_PATH` ignore `package.json` `exports`, so the kit uses `main` and the `testing.ts` file for `gui-kit/testing`.

## Development

```sh
bun install
bun test                      # headless tests: keys, mouse, components, graphics, CLI and sandbox
bun run typecheck
bun run demo                  # demo app: a list and a canvas
bun bench/canvas.ts 200 50    # frame cost per canvas backend
```

The CLI of one kit version starts apps through `src/cli/launch.tsx` and `src/cli/screen.tsx` of another, so their arguments and the `GUI_ARGS`, `GUI_APP_DIR`, `GUI_DATA_DIR` and `GUI_TTY` variables must stay compatible. Bump the version in `package.json` for every change apps can notice; in 0.x a minor bump is a breaking change.

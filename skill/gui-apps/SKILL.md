---
name: gui-apps
description: "Create, run and manage terminal apps built with gui-kit (Ink 8 on Bun). Covers one-off apps that ask the user something and return the answer as JSON with gui ask, and complete apps saved and installed by name (gui <app>), with kit versions and sandboxed permissions. Use when the user asks for an interface, a form, a choice, a table, a dashboard, a file browser or a canvas in the terminal, or to open, install or uninstall one of these apps."
---

# Terminal apps with gui-kit

Every app takes the terminal it starts in full screen and never manages windows: the user manages terminals in Ghostty, or you do with ghostty-mcp. The `gui` command must be on the PATH (`gui --version` prints the kit version; `gui help` lists the commands). To install it: clone the gui-kit repository, run `bun install`, then `ln -s "$PWD/bin/gui" ~/.local/bin/gui`.

## Pick the kind of app

- **One-off:** a single `.tsx` file and nothing to install. Use it to ask the user for a choice, the fields of a form or a confirmation. `gui scratch [name]` creates one from a template in `~/.local/share/gui/scratch` and prints its path; write the app into that file. A `.tsx` file anywhere else works too.
- **Saved:** a folder with `gui.json` and `app.tsx`, installed by name. Create it with `gui new <name>`, or keep a one-off file with `gui keep <file> <name>`.

## Commands

`<app>` is the name of an installed app, a folder with `gui.json` or a `.tsx` file. A name without `/` always means the installed app, even when the current folder has a folder of that name: write `./name` for the folder.

```sh
gui <name> [args]                  # start an installed app
gui run <app> [args]               # start it in the current terminal
gui ask <app> [args]               # stdout: only the JSON passed to finish()
gui screen <app> [--keys 'K'] [--wait MS] [--cols 100] [--rows 30] [args] [-- args]
gui check <app>                    # types + a first render, no terminal needed
gui scratch [name]                 # new one-off file; prints its path
gui keep <file> <name> [--dir D] [--description T] [--bin] [--yes]
gui new <name> [--dir D] [--from file.tsx] [--description T]
gui install [folder] [--bin] [--yes] | gui uninstall <name> | gui ls [--json]
gui kits                           # saved kit versions and the apps on them
gui gc [--days N] [--dry-run]      # delete unused one-off files and kit copies
```

- **`gui run` and `gui ask` need a real terminal.** From your tool shell they exit with 3 and the message `no terminal`. Open them in a Ghostty window with ghostty-mcp (see "Show it to the user").
- **`gui ask`** writes only the JSON to stdout, so `answer=$(gui ask form.tsx)` works like fzf. Exit codes:
  - 0 with one JSON line;
  - 1 if the app closes without `finish()` (`q`, `:q`, `Ctrl-C`) or fails;
  - 2 for CLI errors (unknown app, invalid gui.json, no default export, permissions not approved, kit version not available);
  - 3 if there is no terminal.
  Always check the exit code, not only the output.
- **`gui new <name>`** creates `./<name>`; with `--dir D` it creates the app in `D` itself, not in `D/<name>`. It writes `gui.json`, `app.tsx`, `tsconfig.json` and `.gitignore`, and installs the app right away. It never overwrites files. Names use lowercase letters, digits and dashes; subcommand names (`run`, `ask`, `ls`...) are refused, and so is a name already installed from another folder.
- **`gui keep <file> <name>`** turns a one-off file into a saved app in `./<name>` (or `--dir D`) and installs it. A file from the scratch folder moves into the project; any other file is copied.
- **`gui install --bin`** also writes the command `~/.local/bin/<name>`; a later `gui install` without `--bin` keeps it. `gui uninstall` removes the app from the registry and that command, but never deletes its files or its data.
- **One-off files** in the scratch folder are listed by `gui ls`. Running one marks it as used; `gui gc` deletes those unused for 7 days (`--days N`), and kit copies no installed app uses. `--dry-run` only lists them.
- **Registry and data:** everything lives in `$GUI_HOME`, by default `${XDG_DATA_HOME:-~/.local/share}/gui` (`registry.json`, `kits/`, `scratch/`, `data/`). For tests that must not touch the real registry use `GUI_HOME=<tmp>/gui gui ...`; add `HOME=<tmp>` only to test `--bin`, which writes to `~/.local/bin`.

## gui.json

```json
{
	"name": "notes",
	"description": "Notes for the current project",
	"entry": "app.tsx",
	"kit": "^0.1.0",
	"permissions": {"read": ["$REPO"], "write": ["$CWD/notes"], "run": ["git"], "net": false}
}
```

**Name.** `"name"` uses lowercase letters, digits and dashes; any other name makes every command exit 2. Renaming an installed app in `gui.json` stops it until you put the name back, or `gui uninstall` the old name and `gui install` again. Its data folder follows the installed name.

**Kit version.** `"kit"` is a semver range of the gui-kit versions the app works with; `gui new` writes `^` plus the current version.
- `gui install` copies the current kit to `$GUI_HOME/kits/<version>` and links that copy in the project's `node_modules` (`gui-kit`, `react`, `@types`). The app then runs on that copy, so later kit changes cannot break it. Don't delete or replace those links; `.gitignore` already leaves `node_modules/` out.
- Reinstalling refreshes the copy of that version, for every app on it.
- When `"kit"` no longer matches the copy an installed app runs on, the app stops with exit 2 until `gui install`. To move an app to a newer incompatible kit: change `"kit"`, `gui install`, update the code, then `gui check <name>`.
- A folder that was never installed runs on the newest available kit that matches the range. A range nobody has stops the app with exit 2.
- The entry file of a project counts as the project, wherever its `gui.json` is above it and even through a symlink: same kit, sandbox, approval and data. Any other single file runs on the kit linked in the nearest `node_modules` above its real folder, else on the current kit.

**Permissions.** On macOS a saved app runs inside a sandbox (`sandbox-exec`) built from `"permissions"`; `gui screen` and `gui check` use it too. On other systems the permissions are shown and approved, but not enforced.
- With `"permissions": {}` (what `gui new` writes) an app can read its own folder, its data folder, the kit and files outside your home. In the folder it starts in it can list the files and read `package.json`, `tsconfig.json` and `jsconfig.json`, but no other file; the folders above it, up to your home, can be listed (`bun run` needs that) but not read. It can write only its data folder, temp folders outside your home and the terminal. It has no network at all (no sockets, no DNS) and runs no commands except `bun`, which stays in the sandbox.
- `read`: paths it may also read inside your home. `write`: paths it may also write (and read); without it nothing in your home is writable, even when your home is a temp folder. `run`: command names it may run (`git`, `lsof`), or `"*"` for any. `net`:
  - `false`: nothing, not even listening on a port or a unix socket;
  - `"local"`: connections out to localhost only (`localhost` and `127.0.0.1` work, other host names don't resolve), and no listening, not even on localhost;
  - `true`: everything; an app that serves on a port needs it. A blocked listen shows as `EPERM` (`Bun.listen`) or `EADDRINUSE` (`Bun.serve`).
- With `git` or `"*"` in `run`, the app may also read `~/.gitconfig` and `~/.config/git`; files git reaches through `[include]` or `core.excludesFile` still go in `read`.
- Paths may start with `$CWD` (the folder `gui` was started in), `$REPO` (the git work tree that contains `$CWD`, or `$CWD`), `$APP` (the app folder), `$DATA` (its data folder), `$HOME`, `$TMP` or `~`; a relative path is inside the app folder.
- Programs the app starts stay in its sandbox. List every program a command starts: `bun run build` needs whatever the script runs (`bun` itself is always allowed), and `sh` if it goes through a shell. Setuid programs such as `ps` or `sudo` never run in the sandbox.
- A sandboxed app never gets the variables of a `.env` file: neither Bun's own loading nor the CLI passes them on. `gui` never loads the start folder's `bunfig.toml`, for any app.
- No app may create or change a `tsconfig.json`, `jsconfig.json`, `bunfig.toml` or `.env` file, even where it may write: Bun reads them from the folder a program starts in, so a planted one would run code in the next program started there.
- A sandboxed app reads nothing in `$GUI_HOME` (the registry, other apps' data, the scratch folder) except its own data folder and the kit copy it runs on.
- Without a `"permissions"` field the app has full access.
- The data folder, in `process.env.GUI_DATA_DIR`, is `$GUI_HOME/data/<name>` for an installed app. A folder that was never installed gets `$GUI_HOME/data/.dev/<name>-<hash of its path>`, so data written before `gui install` does not carry over, and moving the folder starts a new one. Keep the app's state there.

**Approval.** `gui install` (and `gui new`, `gui keep`) lists what the app asks for beyond `{}` and needs a yes. In a terminal it asks; from your tool shell it exits with 2 and the list. **Show the list to the user, and only after they agree run the same command with `--yes`.** Never pass `--yes` on your own. Reinstalling with the same or fewer permissions asks nothing. If `gui.json` later asks for more than was approved, the app stops with exit 2 until it is installed again. This holds however an installed app is started: by name, by its folder or by its entry file.

When an operation fails with `EPERM` (`operation not permitted`) inside the app, the sandbox blocked it: add the permission and reinstall. Programs the app runs report a denial in their own words (git: `not a git repository` or `unable to access`, exit 128; others: `No such file` or `Permission denied`), so check a failing command against the permissions first. git needs `read` on `$REPO`, where `.git` is, not only on `$CWD`.

## Writing an app

- The file default-exports its root component.
- Import everything from `'gui-kit'`:
  - the components below, plus `Overlay`, a centered box with no keys;
  - `theme` and `rgb`;
  - the hooks `useFinish`, `useKeys`, `useCommand`, `useMouse`, `useKit`, `useKeymapState`, `useNotify`, `useProcess`, `useGraphicsSuspend`;
  - images: `Image`, `loadImage`, `decodeImage`, `drawBitmap`, `fitRect`;
  - from Ink: `Box`, `Text`, `Newline`, `Spacer`, `useWindowSize`;
  - from React: `useState`, `useEffect`, `useLayoutEffect`, `useRef`, `useMemo`, `useCallback`, `useReducer`, `useContext`, `createContext`, `Fragment`.
- Don't import `ink` directly: it would load a second copy of Ink that reads the wrong terminal, and `gui check` fails. You may import types from `react` (`import type {ReactNode} from 'react'`).
- Wrap the screen in `<Shell title="...">`. The Shell gives the status line, the `:` command line, the `?` help, the menu for multi-key sequences, notifications, and `q` to quit. `hint` replaces the text on the right of the status line: if you set it, mention `?` and `q`.
- The Shell lays its children out in a column, above the status line; content taller than the screen is cut. `List`, `Table`, `Tree`, `Pager`, `Split`, `Tabs` and `Canvas` take all the space left, even a single row. Inside your own `Box`, give that `Box` `flexGrow={1}`; without it a `List` shows at most 10 rows, or as many as `height` asks.
- To return a result, take `const finish = useFinish()` in the component body and call `finish(value)` in a handler. The app closes at once. The value must be JSON-serializable: use `null`, not `undefined`.
- The arguments after the app arrive in `process.env.GUI_ARGS` (a JSON array): `JSON.parse(process.env.GUI_ARGS ?? '[]')`. The app folder is in `GUI_APP_DIR` (for a single file, its folder), the data folder in `GUI_DATA_DIR`, and `process.cwd()` is where `gui` was started.
- Functions passed to `useKeys`, `useCommand` and the components always see the current state, not the state of the first render.
- From `useKit()`:
  - `caps`: what the terminal supports, e.g. `caps.graphics`;
  - `keymap.flash('message')`: a message in the status line.
- `const notify = useNotify()` then `notify('Saved', {kind: 'success'})`: a toast at the top right. Kinds `info`, `success`, `warning`, `error`; it disappears after 4 s (`timeout` in ms, 0 keeps it), errors stay until dismissed. `Esc`, `:dismiss` or a click on a toast dismisses them; if your app binds `<Esc>`, your binding wins, and `:dismiss` and the click still work.

```tsx
import {Form, Shell, useFinish} from 'gui-kit';

export default function App() {
	const finish = useFinish();
	return (
		<Shell title="New customer">
			<Form
				fields={[
					{name: 'name', label: 'Name', type: 'text', placeholder: 'Ada Lovelace'},
					{name: 'kind', label: 'Kind', type: 'select', options: ['person', 'company']},
					{name: 'newsletter', label: 'Newsletter', type: 'checkbox'},
				]}
				onSubmit={finish}
			/>
		</Shell>
	);
}
```

A larger app: tabs, a file tree next to a preview, and a command whose output streams in.

```tsx
import {Pager, ProcessView, Shell, Split, Tabs, Tree, useState, type TreeNode} from 'gui-kit';

export default function App() {
	const [preview, setPreview] = useState('Open a file with Enter.');
	const nodes: TreeNode[] = [{id: 'src', label: 'src', load: async () => [{id: 'a.ts', label: 'a.ts'}]}];
	return (
		<Shell title="Project">
			<Tabs
				tabs={[
					{id: 'files', title: 'Files', content: (
						<Split panes={[
							active => <Tree nodes={nodes} active={active} onOpen={node => setPreview(`You opened ${node.label}`)} />,
							active => <Pager text={preview} active={active} />,
						]} sizes={[1, 2]} />
					)},
					{id: 'test', title: 'Tests', content: <ProcessView argv={['bun', 'test']} />},
				]}
			/>
		</Shell>
	);
}
```

A hidden tab is unmounted: coming back to it, cursor, `/` filter and sort start over, and a `ProcessView` in it is killed. Keep state you need in the component that renders the `Tabs`.

## Components

| Component | Use |
|---|---|
| `List` | A long list. Props: `items`, `render(item, selected)`, `text(item)` (the text `/` searches), `onOpen`, `onCursor(item \| undefined)` (called on mount and whenever the highlighted item changes; `undefined` for an empty list, a filter with no match, or unmount), `id(item)` (optional: what makes two items the same one; by default the row, `text` and the item's own string/number/boolean fields), `active`, `height`. Keys: `j`/`k` or the arrows, `gg`/`G`, `Ctrl-d`/`Ctrl-u`, Enter opens. `/` filters while you type: Enter keeps the filter, `Esc` cancels it, `/` then Enter with no text removes it. The wheel scrolls; a click selects and a second click on the highlighted row opens it. |
| `Select` | Pick one option. Props: `options` (`{label, value, hint?}[]`), `onSelect(value)`, `onCursor(value \| undefined)`, `id(value)`, `active`. `hint` shows in grey next to the label and `/` searches it too. Same keys and clicks as `List`. |
| `Table` | Rows and columns. Props: `columns`, `rows`, `onOpen`, `onCursor(row \| undefined)`, `id(row)`, `active`. Each column is `{key, title, width?, align?: 'left' \| 'right', format?: (value, row) => string}`, where `value` has that key's type. Same keys as `List`, plus `s` (sort by the next column) and `S` (reverse). In a narrow pane every column but the last keeps its width and the last one is cut. |
| `Tree` | Expandable tree. Props: `nodes` (`{id, label, children?, load?: () => Promise<TreeNode[]>}[]`, `id` unique among siblings), `onOpen(node)`, `onCursor(node \| undefined)`, `active`, `height`. `load` fetches children the first time a node opens (shows `loading…`; a failure closes it again with a message). Keys: `j`/`k` with counts, `l`/Right opens or goes in, `h`/Left closes or goes to the parent, Enter opens a leaf or toggles a branch, `zR` opens every loaded node, `zM` closes all, `gg`/`G`, `/` filters (matches with their parents). Click selects, a second click opens, the wheel scrolls. |
| `Pager` | Long text (a string or lines). Props: `text`, `active`, `height`, `follow`, `ansi`, `offset` (lines already cut from the front, e.g. `job.dropped`, so the view and the matches stay on their lines). Draws only the visible lines, fine with 100k lines. Keys: `j`/`k`, `Ctrl-d`/`Ctrl-u`, `Ctrl-f`/`Ctrl-b`, `gg`/`G`, `/` searches as you type, `n`/`N` next/previous match, `F` follows the end as lines are added. Strips escape codes; `ansi` keeps colors. Long lines are cut, not wrapped. |
| `Tabs` | Tab bar with one tab's content mounted. Props: `tabs` (`{id, title, content}[]`), `selected` and `onChange(id)` (optional, to control it), `active`. Keys: `gt` next, `gT` previous, `3gt` third tab; a click on a title opens it. |
| `Split` | Panes side by side (`direction: 'row'`, default) or stacked (`'column'`). Props: `panes` (functions `active => node`, so pass `active` to the component inside), `sizes` (ratios), `direction`, `active`, and to control the focus `focus` (pane index) with `onFocusChange(index)`. Keys: `Ctrl-w w` cycles the focus, `Ctrl-w h`/`l` (row) or `k`/`j` (column) move it; a click in a pane focuses it. One level of `Split` only. |
| `Form` | Fields in a column; see below. |
| `TextInput` | One line of text. Props: `value`, `onChange`, `onSubmit`, `placeholder`, `active`. In normal mode letters are commands: `i`, `a` or Enter start typing, `cc` clears and types. While typing: Enter confirms and calls `onSubmit`; `Esc` stops without `onSubmit`; Backspace deletes; `Ctrl-u` clears; `Ctrl-w` deletes a word. Tab and the arrows do nothing, and text is always added at the end. |
| `Confirm` | A yes/no question. Props: `question`, `onAnswer(yes)`, `active`. `y` or Enter answer yes, `n` or `Esc` no. While shown it takes every key and click. |
| `Modal` | A window over the screen. Props: `title`, `onClose`, `bindings` (extra keys, the same objects as `useKeys`). Inside a `Shell` it is drawn over the screen above the status line wherever you render it, a `Split` pane or a tab included; a `Modal` inside a `Modal` draws over it (an `Overlay` rendered in a pane is not lifted: it stays clipped to the pane). `q` and `Esc` close it. Components inside get keys and clicks, so a `Form` or a `Confirm` in a `Modal` work. While it is open, `:`, `?`, your `:name` commands and the keys and clicks of the screen below don't arrive. |
| `ProcessView` | Runs a command and streams its output. Props: `argv`, `cwd`, `env` (added to the environment), `active`, `job`, `onExit(code, signal, error?)`. It starts when mounted; the header shows the command, a spinner, then `exit N`; the output is a `Pager` that follows the end. Keys: `r` runs it again, `Ctrl-k` stops it (SIGTERM; a second `Ctrl-k` sends SIGKILL). Unmounting stops it too. `onExit` fires once per run: `(code, null)`, `(null, signal)`, or `(null, null, message)` when the command could not start; with `job` only for runs that end while the view is mounted. With `job` (a handle from `useProcess` owned higher up) it only shows that job: nothing starts on mount, unmounting doesn't stop it, so the command survives a tab switch, and `r` restarts it through the handle. Pass the same `argv`, `cwd` and `env` you gave `job.start`: the header shows the view's `argv` and `r` reruns it. |
| `Spinner`, `ProgressBar` | `<Spinner label="Loading" />`; `<ProgressBar value={0.4} label="Copy" percent />` (`value` from 0 to 1, optional `width`). |
| `Image` | A PNG or JPEG, turned the right way up by its EXIF orientation. Props: `src` (path or `Bitmap`), `fit` (`'contain'`, `'cover'`, `'fill'`), `width`, `height` (cells; with neither it fills its parent), `smooth`. Picks the best output itself; a file that can't be read shows one line with the reason. |
| `Canvas` | Drawing; see "Graphics". |

**`useProcess()`** for your own views: `const proc = useProcess()` gives `lines`, `running`, `exitCode`, `signal`, `error`, `dropped` (lines cut from the front in this run), `runs` (how many times `start` was called), `start(argv, {cwd, env})`, `kill(signal?)`, `clear()`. The child gets its own process group: `start` and unmount stop the previous run with SIGTERM, then SIGKILL after 2 s, and `kill` also reaches what the command left running. Keeps the last 10,000 lines (`useProcess({maxLines})`); pass `offset={proc.dropped}` to a `Pager` that shows them. `useProcess({onExit: (code, signal, error) => ...})` hears the end of every run, a command that cannot start included, even while no view shows it. Commands you run must be in `permissions.run`.

**`Form`.**
- Every field has `name` and `label`, plus its type:
  - `{type: 'text', placeholder?, default?}`;
  - `{type: 'select', options: string[], default?}`;
  - `{type: 'checkbox', default?}`.
- Props: `fields`, `onSubmit(values)`, `submitLabel`, `active`. `values` is an object `{name: string or boolean}`.
- The form submits with empty fields too: validation is up to the app.
- In normal mode:
  - `j`/`k`, Tab or the arrows change field;
  - `h`/`l` change choice, wrapping around;
  - `x` or Enter tick a checkbox, move to the next choice or, on the submit row, submit;
  - on a text field Enter starts typing.
- A text field also has the `TextInput` commands: `i`, `a`, `cc`, and while typing `Ctrl-u` and `Ctrl-w`.
- While typing, Enter confirms the field and moves to the next.
- `Ctrl-s` submits from any field, even while typing.

## Keys: Vim style

- `:` opens the command line: `:q` quits, `:help` shows the help. `?` shows the help with every active key; it does not scroll, so a short terminal cuts it. `q` quits the app, or closes the help or a `Modal`.
- `Esc` never quits the app. It cancels pending keys and counts, goes back to normal mode from insert mode or the command line, closes help, toasts and `Modal`s, and in `Confirm` answers no.
- Movement comes from the components, not from the Shell.
- **Counts.** A count (`5j`) reaches `run(count)` of every key, but only `j`/`k` (of lists, tables, trees, pagers and forms), the arrows of `List`, `Select` and `Table`, `gt`, and your own keys that read `count` use it: `5G` still goes to the last row. A digit is a count unless the app has a key that starts with that digit: then `1` is a key, and a count can no longer start with `1`. While typing or in the `/` filter, digits are text.
- **Multi-key sequences.** A key that also starts another one (`g` when both `g` and `gt` exist) fires after 700 ms, or at once when a different key arrives, which then counts on its own. A prefix that is not a command by itself waits for the next key. `Esc` cancels.
- `Space` does nothing by itself. Use it as a prefix for your app's keys (`<Space>1`, `<Space>f`): the sequence menu shows them.
- **Adding keys:** `useKeys([{keys: 'dd', desc: 'Delete', group: 'List', mode?: 'normal' | 'insert', run: count => ...}], {active, modal, priority, onText})`.
  - The notation is Vim's (`gg`, `<C-d>`, `<Space>x`), with exactly these names: `<CR>`, `<Esc>`, `<Tab>`, `<S-Tab>`, `<BS>`, `<Del>`, `<Up>`, `<Down>`, `<Left>`, `<Right>`, `<PageUp>`, `<PageDown>`, `<Home>`, `<End>`, `<Space>`, `<C-x>` with a lowercase letter, and `<M-x>`. Any other name (`<Enter>`, `<C-D>`) stops the app with an unknown-key error, which `gui check` shows.
  - `desc` and `group` show in the help; `group: 'hidden'` hides them.
  - The highest priority wins; on a tie the `useKeys` call registered last wins (not the `group`). Values: Shell -10, normal 0, `modal: true` 10, help 1000; inside a `Modal` everything goes up by 20.
  - A component registers again when its keys or `active` change (the `Form` each time you start or stop typing), so on a tie the winner changes while the app is used. Don't use the keys of active components for your own: every key in the table above and in their `?` help (`j`, `k`, `h`, `l`, `gg`, `G`, `<C-d>`, `<C-u>`, `<C-f>`, `<C-b>`, `x`, `s`, `S`, `i`, `a`, `cc`, `/`, `n`, `N`, `F`, `r`, `y`, `zR`, `zM`, `gt`, `gT`, `<C-w>`, `<C-k>`, `<C-s>`, Tab, the arrows and Enter). On a tie your app's keys win and silently take them away from the component.
  - `modal: true` hides everything with a lower priority.
  - In `'insert'` mode only single named keys fire (`<C-s>`, `<CR>`, `<Tab>`...). Letters and digits always go into the text, and sequences don't fire. `<Esc>` in `'insert'` mode never fires, because it always goes back to normal mode. The `?` help shows only normal-mode keys.
- `Ctrl-C` always quits the app (Ink handles it before the kit).
- **`:name` commands:** `useCommand('name', 'description', args => ...)`. `args` is a string (the rest of the line), not an array. While a `Modal` or a `Confirm` is open, `:` does not arrive.
- Don't redefine `:`, `?` and `q` at app level; a `Modal` uses them to close.
- Keep one component with `j`/`k` active at a time (`List`, `Select`, `Table`, `Tree`, `Pager`, `Form`) using `active`, or let `Split` and `Tabs` do it: they compete for the same keys, and `/` has one receiver.

## Style

- Colors only from `theme`, never literal values: `background`, `text`, `muted`, `accent`, `accentText` (text on `accent`), `border`, `selection`, `success`, `warning`, `danger`, and `modes.normal`, `modes.insert`, `modes.command`. For a `Canvas`, convert them with `rgb(theme.accent)`.
- Short interface text, in the user's language. At the top of each screen, one line that says what can be done.
- For a second view use `Tabs`, a `Modal` or a `Split` with two panes; no windows inside the app.

## Graphics

**What the terminal can show** is in `caps.graphics`:
- `'kitty'`: real pixels. Automatic in kitty and in Ghostty 1.4 or later, never inside tmux. Ghostty 1.3.x needs `GUI_GRAPHICS=kitty`.
- `'sixel'`: only with `GUI_GRAPHICS=sixel` on a terminal that reports sixel and its cell size. Not yet checked in a real terminal.
- `'none'`: text only. `GUI_GRAPHICS=none` forces it.

`Image` chooses by itself (kitty, sixel, else colored half blocks). For a `Canvas`, pass `backend={caps.graphics === 'none' ? 'braille' : caps.graphics}`; a backend the terminal can't show falls back to braille.

**`Canvas`.**
- Required props:
  - `backend`: `'braille'`, `'half'`, `'kitty'` or `'sixel'`;
  - `version`: a number to increase on every change of the scene;
  - `draw(raster, {sx, sy})`.
- It redraws only when `version`, its size or `backend` change.
- It takes all the space left in its container.
- Optional:
  - `background`: an RGB color; the default `[250, 250, 245]` is almost white, so for a dark background pass `rgb(theme.background)`;
  - `onPointer`;
  - `onFrame(ms, bytes)`.

**`Raster`.**
- `raster.width` and `raster.height` are in raster pixels; `sx` and `sy` are pixels per cell: 2×4 with braille, 1×2 with `'half'`, up to 10×20 with kitty, and exactly the terminal's cell size with sixel.
- Methods:
  - `plot(x, y, c)`;
  - `dot(cx, cy, r, c)`;
  - `line`, `rect` and `ellipse`, with `(x0, y0, x1, y1, thickness, c)`;
  - `clear()`.
- `thickness` is the brush radius: 0 draws one pixel. `rect` and `ellipse` draw only the outline; to fill an area draw lines side by side.
- `draw` gets a new, cleared raster every time, so `clear()` is not needed. Import the `Raster` type from `'gui-kit'`.
- Colors are `[r, g, b]` triples.
- Images in a canvas: `const bitmap = await loadImage(path)` (PNG or JPEG, in a `useEffect`), then in `draw`: `drawBitmap(raster, bitmap, {x, y, width, height, fit: 'contain'})`.

**Floating boxes over images.** Sixel images are drawn over Ink's text, so the help, `Overlay`, `Modal`, toasts and the sequence menu hide the images they overlap while they are shown (a whole image hides even when the box covers only part of it); an `Image` or `Canvas` inside a `Modal` still shows. A box of your own drawn over an image (`position="absolute"`, later in the tree than the image) should call `useGraphicsSuspend(visible)` too. Kitty images don't need it.

**`onPointer`.**
- Receives `{kind: 'down' | 'up' | 'drag' | 'wheel', button, wheel?: 'up' | 'down', x, y}`.
- `x` and `y` are in cells from the canvas corner: with the pixel mouse they have real decimals, otherwise they are the cell center.
- In the raster they become `x * sx`, `y * sy`. `onPointer` does not get `sx` and `sy`: keep them in a `useRef` inside `draw` (`scale.current = {sx, sy}`).
- While a `Modal` or a `Confirm` is open, `onPointer` gets no clicks.

**Safety.** The kit sends kitty images as PNG and must never use `o=z`: Ghostty 1.3.1 crashes on zlib streams with fixed Huffman blocks, and the crash closes every tab of the user (`bench/ghostty-zlib-crash.md` in the gui-kit repository). Try graphics changes only in a separate Ghostty instance (`open -na Ghostty.app --args --window-save-state=never`), never in the user's Ghostty.

## Check before delivering

1. **`gui check app.tsx`** must print `types ok` and `starts and draws`. The second check lasts about 100 ms and presses no keys: it does not find errors that come later or after a key, nor a wrong layout. For those use `gui screen`.
2. **`gui screen app.tsx --keys '...'`** prints the screen after the keys.
   - Keys use the same names as `useKeys`: `5j`, `/find<CR>`, `<Esc>`, `<C-s>`, `<S-Tab>`, `<Space>`. While typing in a field, a plain space is a space. A name it doesn't know makes it exit with 2.
   - It prints text only, without colors. The selection shows as `▌` in `List`, `Select`, `Table` and `Tree` and as `›` in a `Form`, but a field's placeholder looks exactly like a typed value. If something only differs by color, add a visible mark (a border, a `▌`).
   - Try the main keys, a field with spaces, `?` and `q`.
   - After the screen it prints `[finish] <json>` if the app called `finish()`, or `[exit]` if it quit without. Either way the screen is the last frame before the exit and the exit code is 0, so read the output.
   - Arguments for the app go after the app; those after `--` arrive verbatim, even when they look like `gui screen` options.
   - If the app fails, it exits with 1 and writes `[error]` and the stack to stderr. If the error is in rendering, Ink's error box replaces the app.
   - Without a default export it exits with 2.
   - It runs in the app's sandbox, so a missing permission shows up here as `EPERM`.
3. **Limits of `gui screen`:**
   - no mouse;
   - it waits about 130 ms after the last key (200 ms after `Esc`): what happens later doesn't show;
   - don't end `--keys` with a prefix, because it would fire only after 700 ms;
   - for work that takes time (loading, a command), put `<Wait>` in `--keys` (250 ms each, repeatable: `<Wait><Wait>`) before the keys that need it, and `--wait MS` to wait longer before the screen is taken. Apps pinned to an older kit reject `<Wait>`.
4. **Show it to the user** with ghostty-mcp:
   - `open_terminal` with `where: "window"` or `"tab"`;
   - `send_text` with `gui <name>`, or `gui ask file.tsx > answer.json; echo "exit=$?"`;
   - to drive it yourself: `send_keys` for named keys (`esc`, `enter`, `ctrl+s`) and `send_text` with `mode: "type"` and `submit: false` for text (without `submit: false` it presses Enter too);
   - `read_screen` or `wait_for` to check;
   - at the end read the file and the exit code.
5. **Report what you checked and how:** without a terminal, live, or not checked.

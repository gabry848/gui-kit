// Runs a kit app inside a virtual terminal (xterm.js, headless), so tests and
// agents can type keys, click and read the screen exactly as a user sees it.
// convertEol stands in for the tty driver, which turns \n into \r\n.

import {EventEmitter} from 'node:events';
import type {ReactNode} from 'react';
import {render} from 'ink';
import xterm from '@xterm/headless';
import {KitProvider} from './context.js';
import {GraphicsContext, GraphicsLayer} from './graphics.js';
import {InputSplitter} from './input.js';
import {tokenize} from './keymap.js';
import type {Caps} from './probe.js';
import {RENDER_OPTIONS} from './runtime.js';

class FakeStdin extends EventEmitter {
	isTTY = true;
	setRawMode() {}
	setEncoding() {}
	resume() {}
	pause() {}
	ref() {}
	unref() {}
	push(data: string) {
		this.emit('data', data);
	}
}

const KEY_BYTES: Record<string, string> = {
	'<Esc>': '\u001B',
	'<CR>': '\r',
	'<Tab>': '\t',
	'<BS>': '\u007F',
	'<Space>': ' ',
	'<Up>': '\u001B[A',
	'<Down>': '\u001B[B',
	'<Right>': '\u001B[C',
	'<Left>': '\u001B[D',
	'<S-Tab>': '\u001B[Z',
	'<Del>': '\u001B[3~',
	'<Home>': '\u001B[H',
	'<End>': '\u001B[F',
	'<PageUp>': '\u001B[5~',
	'<PageDown>': '\u001B[6~',
};

function bytesFor(token: string): string {
	const named = KEY_BYTES[token];
	if (named) return named;
	const ctrl = /^<C-([a-z])>$/.exec(token);
	if (ctrl) return String.fromCharCode(ctrl[1]!.charCodeAt(0) - 96);
	const meta = /^<M-(.)>$/u.exec(token);
	if (meta) return '\u001B' + meta[1];
	// A name it cannot send must not be typed as the characters "<", "E", "n"...
	if (token.length > 1 && token.startsWith('<')) throw new Error(`gui screen non sa inviare il tasto ${token}`);
	return token;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const TEST_CAPS: Caps = {graphics: 'none', kittyGraphicsDetected: false, sixelDetected: false, terminal: undefined, truecolor: true, sgrPixels: false, syncOutput: true, kittyKeyboard: false, cell: undefined, inTmux: false};

export async function headless(node: ReactNode, {cols = 100, rows = 30, caps = TEST_CAPS} = {}) {
	const term = new xterm.Terminal({cols, rows, allowProposedApi: true, convertEol: true});
	const visible = () => {
		const buffer = term.buffer.active;
		return Array.from({length: rows}, (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
	};
	// Leaving the alternate screen on exit blanks it, so keep the frame drawn
	// just before that, once xterm has processed everything up to it.
	let lastFrame: string[] | undefined;
	let raw = '';
	const LEAVE_ALT = '\u001B[?1049l';
	const stdin = new FakeStdin();
	const stdout = Object.assign(new EventEmitter(), {
		isTTY: true,
		columns: cols,
		rows,
		// Ink waits for the write callback before waitUntilExit resolves.
		write(data: string, encodingOrDone?: unknown, done?: () => void) {
			const callback = typeof encodingOrDone === 'function' ? (encodingOrDone as () => void) : done;
			raw += data;
			const leave = data.indexOf(LEAVE_ALT);
			if (leave === -1 || lastFrame) {
				term.write(data, callback);
			} else {
				term.write(data.slice(0, leave), () => {
					lastFrame = visible();
				});
				term.write(data.slice(leave), callback);
			}
			return true;
		},
	});
	const input = new InputSplitter(stdin as unknown as NodeJS.ReadStream);
	let result: {value: unknown} | undefined;
	let exited = false;
	let error: unknown;
	const onFinish = (value: unknown) => {
		result = {value};
	};
	// As in run(): with sixel, Ink writes through the graphics layer.
	const layer = caps.graphics === 'sixel' ? new GraphicsLayer(stdout as unknown as NodeJS.WriteStream, caps.syncOutput) : undefined;
	const tree = <KitProvider caps={caps} input={input} onFinish={onFinish}>{node}</KitProvider>;
	const instance = render(<GraphicsContext.Provider value={layer}>{tree}</GraphicsContext.Provider>, {
		...RENDER_OPTIONS,
		stdout: layer?.stream ?? (stdout as unknown as NodeJS.WriteStream),
		stdin: input as unknown as NodeJS.ReadStream,
		interactive: true,
		patchConsole: false,
		kittyKeyboard: {mode: 'disabled'},
	});
	instance.waitUntilExit().then(
		() => {
			exited = true;
		},
		(reason: unknown) => {
			exited = true;
			error = reason;
		},
	);

	const settle = async (ms = 40) => {
		await sleep(ms);
		await new Promise<void>(resolve => term.write('', resolve));
	};
	await settle();

	return {
		/** Types keys in Vim notation, e.g. `5j`, `gg`, `:q<CR>`. */
		async press(keys: string) {
			for (const token of tokenize(keys)) {
				stdin.push(bytesFor(token));
				// A lone Esc is only flushed after Ink's escape timeout.
				await sleep(token === '<Esc>' ? 80 : 5);
			}
			await settle();
		},
		/** Sends text in one chunk, the way a paste-free fast typist or an agent does. */
		async type(text: string) {
			stdin.push(text);
			await settle();
		},
		/** Sends a mouse report at a 0-based cell. */
		async mouse(kind: 'down' | 'up' | 'drag' | 'wheelUp' | 'wheelDown', x: number, y: number) {
			const code = {down: 0, up: 0, drag: 32, wheelUp: 64, wheelDown: 65}[kind];
			stdin.push(`\u001B[<${code};${x + 1};${y + 1}${kind === 'up' ? 'm' : 'M'}`);
			await settle(20);
		},
		/** The visible screen as text, one string per row; once the app has exited, its last frame. */
		lines(): string[] {
			return lastFrame ?? visible();
		},
		screen(): string {
			return this.lines().join('\n');
		},
		/** Every byte written to the terminal so far, escape sequences included. */
		output(): string {
			return raw;
		},
		/** What the app passed to finish(), if it has. */
		result(): {value: unknown} | undefined {
			return result;
		},
		/** Whether the app has exited (finish, q, :q or an error). */
		exited(): boolean {
			return exited;
		},
		/** The error the app crashed with, if any. */
		error(): unknown {
			return error;
		},
		async exit() {
			instance.unmount();
			await settle(10);
			layer?.dispose();
			term.dispose();
		},
		settle,
	};
}

// Runs a kit app inside a virtual terminal (xterm.js, headless), so tests and
// agents can type keys, click and read the screen exactly as a user sees it.
// convertEol stands in for the tty driver, which turns \n into \r\n.

import {EventEmitter} from 'node:events';
import type {ReactNode} from 'react';
import {render} from 'ink';
import xterm from '@xterm/headless';
import {KitProvider} from './context.js';
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
};

function bytesFor(token: string): string {
	const named = KEY_BYTES[token];
	if (named) return named;
	const ctrl = /^<C-(.)>$/.exec(token);
	if (ctrl) return String.fromCharCode(ctrl[1]!.toLowerCase().charCodeAt(0) - 96);
	return token;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const TEST_CAPS: Caps = {graphics: 'none', kittyGraphicsDetected: false, truecolor: true, sgrPixels: false, syncOutput: true, kittyKeyboard: false, cell: undefined, inTmux: false};

export async function headless(node: ReactNode, {cols = 100, rows = 30, caps = TEST_CAPS} = {}) {
	const term = new xterm.Terminal({cols, rows, allowProposedApi: true, convertEol: true});
	const stdin = new FakeStdin();
	const stdout = Object.assign(new EventEmitter(), {
		isTTY: true,
		columns: cols,
		rows,
		write(data: string) {
			term.write(data);
			return true;
		},
	});
	const input = new InputSplitter(stdin as unknown as NodeJS.ReadStream);
	let result: {value: unknown} | undefined;
	// Leaving the alternate screen on exit blanks it, so keep the last frame.
	let lastFrame: string[] | undefined;
	const visible = () => {
		const buffer = term.buffer.active;
		return Array.from({length: rows}, (_, row) => buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
	};
	const onFinish = (value: unknown) => {
		result = {value};
		lastFrame = visible();
	};
	const instance = render(<KitProvider caps={caps} input={input} onFinish={onFinish}>{node}</KitProvider>, {
		...RENDER_OPTIONS,
		stdout: stdout as unknown as NodeJS.WriteStream,
		stdin: input as unknown as NodeJS.ReadStream,
		interactive: true,
		patchConsole: false,
		kittyKeyboard: {mode: 'disabled'},
	});

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
		/** The visible screen as text, one string per row; after finish(), the last frame before it. */
		lines(): string[] {
			return lastFrame ?? visible();
		},
		screen(): string {
			return this.lines().join('\n');
		},
		/** What the app passed to finish(), if it has. */
		result(): {value: unknown} | undefined {
			return result;
		},
		async exit() {
			instance.unmount();
			await settle(10);
			term.dispose();
		},
		settle,
	};
}

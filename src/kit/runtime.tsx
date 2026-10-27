import {openSync} from 'node:fs';
import {ReadStream, WriteStream} from 'node:tty';
import type {ReactNode} from 'react';
import {render} from 'ink';
import {KitProvider} from './context.js';
import {InputSplitter} from './input.js';
import {MOUSE_OFF, mouseOn} from './mouse.js';
import {probe, type Caps} from './probe.js';

const KITTY_FREE_ALL = '\u001B_Ga=d,d=A,q=2\u001B\\';

export const RENDER_OPTIONS = {
	alternateScreen: true,
	incrementalRendering: true,
	maxFps: 60,
} as const;

export type RunResult = {finished: true; value: unknown} | {finished: false};

/**
 * The terminal the app draws on. When stdout is piped, as in
 * `result=$(gui ask form.tsx)`, the app opens its terminal device like fzf
 * does, so the result can go to stdout. It opens the real device
 * (/dev/ttys016), because on macOS Bun's writer cannot watch /dev/tty with
 * kqueue (EINVAL).
 */
function terminal(): {stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream} {
	if (process.stdout.isTTY && process.stdin.isTTY) {
		return {stdin: process.stdin, stdout: process.stdout};
	}
	const name = Bun.spawnSync(['ps', '-o', 'tty=', '-p', String(process.pid)]).stdout.toString().trim();
	const device = name && name !== '??' ? `/dev/${name}` : '/dev/tty';
	return {
		stdin: new ReadStream(openSync(device, 'r')) as NodeJS.ReadStream,
		stdout: new WriteStream(openSync(device, 'w')) as NodeJS.WriteStream,
	};
}

/** Starts a kit app full screen and resolves on exit, with its result if it called finish(). */
export async function run(app: (caps: Caps) => ReactNode): Promise<RunResult> {
	const {stdin, stdout} = terminal();
	const caps = await probe(stdin, stdout);
	let result: RunResult = {finished: false};
	const restore = () => {
		stdout.write(MOUSE_OFF + (caps.graphics === 'kitty' ? KITTY_FREE_ALL : ''));
		if (stdin.isTTY) stdin.setRawMode(false);
	};
	stdout.write(mouseOn(caps.sgrPixels));
	process.once('exit', restore);

	const input = new InputSplitter(stdin);
	const onFinish = (value: unknown) => {
		result = {finished: true, value};
	};
	const instance = render(<KitProvider caps={caps} input={input} onFinish={onFinish}>{app(caps)}</KitProvider>, {
		...RENDER_OPTIONS,
		stdout,
		stdin: input as unknown as NodeJS.ReadStream,
		// The probe already asked; letting Ink ask again leaves its reply on screen.
		kittyKeyboard: {mode: caps.kittyKeyboard ? 'enabled' : 'disabled', flags: ['disambiguateEscapeCodes']},
	});
	await instance.waitUntilExit();
	restore();
	stdin.pause();
	return result;
}

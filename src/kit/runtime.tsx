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

/** Starts a kit app full screen in the current terminal and resolves on exit. */
export async function run(app: (caps: Caps) => ReactNode): Promise<void> {
	const caps = await probe();
	const stdout = process.stdout;
	const restore = () => {
		stdout.write(MOUSE_OFF + (caps.graphics === 'kitty' ? KITTY_FREE_ALL : ''));
		if (process.stdin.isTTY) process.stdin.setRawMode(false);
	};
	stdout.write(mouseOn(caps.sgrPixels));
	process.once('exit', restore);

	const input = new InputSplitter(process.stdin);
	const instance = render(<KitProvider caps={caps} input={input}>{app(caps)}</KitProvider>, {
		...RENDER_OPTIONS,
		stdin: input as unknown as NodeJS.ReadStream,
		// The probe already asked; letting Ink ask again leaves its reply on screen.
		kittyKeyboard: {mode: caps.kittyKeyboard ? 'enabled' : 'disabled', flags: ['disambiguateEscapeCodes']},
	});
	await instance.waitUntilExit();
	restore();
}

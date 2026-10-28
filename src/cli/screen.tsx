// Child process for `gui screen`: renders an app in a virtual terminal,
// types the keys and prints what the screen shows, without a real terminal.
// After the screen it prints `[finish] <json>`, or `[exit]` when the app
// ended; an app that crashed exits 1 with the error on stderr.
// usage: screen.tsx <file> <keys> <cols> <rows> [wait ms before the screen is taken]

import {pathToFileURL} from 'node:url';

// Ink's cursor library shows the cursor on stderr at exit; there is no
// terminal here, so drop that sequence and keep stderr for real errors.
const writeErr = process.stderr.write.bind(process.stderr);
process.stderr.write = ((chunk: string | Uint8Array, ...rest: unknown[]) =>
	String(chunk) === '\u001B[?25h' ? true : writeErr(chunk, ...(rest as []))) as typeof process.stderr.write;
import type {ComponentType} from 'react';
import {headless} from 'gui-kit/testing';

const [file, keys = '', cols = '100', rows = '30', wait = '0'] = process.argv.slice(2);
const {default: App} = (await import(pathToFileURL(file!).href)) as {default?: ComponentType};
if (typeof App !== 'function') {
	console.error(`${file}: the app must default-export its component`);
	process.exit(2);
}

const app = await headless(<App />, {cols: Number(cols), rows: Number(rows)});
if (keys) {
	try {
		await app.press(keys);
	} catch (error) {
		console.error(String(error instanceof Error ? error.message : error));
		await app.exit();
		process.exit(2);
	}
}
await app.settle(80 + (Number(wait) || 0));
const lines = app.lines();
while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop();
process.stdout.write(lines.join('\n') + '\n');
const result = app.result();
const error = app.error();
if (result) process.stdout.write(`\n[finish] ${JSON.stringify(result.value)}\n`);
else if (app.exited() && !error) process.stdout.write('\n[exit] the app quit without finish()\n');
await app.exit();
if (error) {
	// Under Bun the stack of an error thrown in a key handler starts with a bare "Error".
	console.error(error instanceof Error ? `[error] ${error.message}\n${error.stack ?? ''}` : `[error] ${String(error)}`);
	process.exit(1);
}
process.exit(0);

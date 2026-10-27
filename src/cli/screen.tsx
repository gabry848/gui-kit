// Child process for `gui screen`: renders an app in a virtual terminal,
// types the keys and prints what the screen shows, without a real terminal.
// usage: screen.tsx <file> <keys> <cols> <rows>

import {pathToFileURL} from 'node:url';
import type {ComponentType} from 'react';
import {headless} from 'gui-kit/testing';

const [file, keys = '', cols = '100', rows = '30'] = process.argv.slice(2);
const {default: App} = (await import(pathToFileURL(file!).href)) as {default?: ComponentType};
if (typeof App !== 'function') {
	console.error(`${file}: l'app deve esportare di default il suo componente`);
	process.exit(2);
}

const app = await headless(<App />, {cols: Number(cols), rows: Number(rows)});
if (keys) await app.press(keys);
await app.settle(80);
const lines = app.lines();
while (lines.length > 0 && lines.at(-1)!.trim() === '') lines.pop();
process.stdout.write(lines.join('\n') + '\n');
const result = app.result();
if (result) process.stdout.write(`\n[finish] ${JSON.stringify(result.value)}\n`);
await app.exit();
process.exit(0);

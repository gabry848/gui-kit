// Redraws a full-screen kitty canvas at 30 fps for 6 s, the way the kit does
// while drawing, and logs progress. Run it in a terminal you can afford to lose.
import {appendFileSync} from 'node:fs';
import {kittyPlaceholders, kittyTransmit, KITTY_MAX_CELLS} from '../src/kit/canvas/encode.js';
import {Raster} from '../src/kit/canvas/raster.js';

const logPath = process.argv[2] ?? 'kitty-stress.log';
const log = (line: string) => appendFileSync(logPath, `${new Date().toISOString()} ${line}\n`);
const cols = Math.min(process.stdout.columns ?? 80, KITTY_MAX_CELLS);
const rows = Math.min((process.stdout.rows ?? 24) - 1, KITTY_MAX_CELLS);
const raster = new Raster(cols * 10, rows * 20, [250, 250, 245]);
const out = (data: string) => process.stdout.write(data);

log(`start ${cols}x${rows} cells`);
out('\u001B[?1049h\u001B[?25l');
const lines = kittyPlaceholders(cols, rows, 9);
let x = 10;
let y = 10;
for (let frame = 0; frame < 180; frame++) {
	const nx = (x + 37) % raster.width;
	const ny = (y + 23) % raster.height;
	raster.line(x, y, nx, ny, 2, [40 + (frame % 200), 90, 220]);
	x = nx;
	y = ny;
	const placeholders = frame === 0 ? lines.map((line, row) => `\u001B[${row + 1};1H${line}`).join('') : '';
	out('\u001B[?2026h' + kittyTransmit(raster, cols, rows, 9) + placeholders + '\u001B[?2026l');
	if (frame % 30 === 0) log(`frame ${frame}`);
	await new Promise(resolve => setTimeout(resolve, 33));
}
out('\u001B_Ga=d,d=A,q=2\u001B\\\u001B[?25h\u001B[?1049l');
log('done');

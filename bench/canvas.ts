// Time to rasterize and encode one full-screen canvas frame per backend.
import {encodeBraille, encodeHalf, kittyPlaceholders, kittyTransmit, pixelsPerCell, type Backend} from '../src/kit/canvas/encode.js';
import {Raster} from '../src/kit/canvas/raster.js';
import {sixelFor} from '../src/kit/graphics.js';

const cols = Number(process.argv[2] ?? 200);
const rows = Number(process.argv[3] ?? 50);
const strokes = Array.from({length: 40}, (_, index) =>
	Array.from({length: 60}, (_, step) => [((index * 37 + step * 3) % cols), ((index * 11 + step) % rows)] as const),
);

for (const backend of ['braille', 'half', 'kitty', 'sixel'] as Backend[]) {
	const {sx, sy} = pixelsPerCell(backend, {w: 10, h: 20});
	const times: number[] = [];
	let bytes = 0;
	for (let run = 0; run < 15; run++) {
		const started = performance.now();
		const raster = new Raster(cols * sx, rows * sy, [250, 250, 245]);
		for (const stroke of strokes) {
			for (let index = 1; index < stroke.length; index++) {
				raster.line(stroke[index - 1]![0] * sx, stroke[index - 1]![1] * sy, stroke[index]![0] * sx, stroke[index]![1] * sy, Math.min(sx, sy) / 6, [40, 90, 220]);
			}
		}
		const out = backend === 'kitty'
			? [kittyTransmit(raster, cols, rows, 1), ...kittyPlaceholders(cols, rows, 1)]
			: backend === 'sixel' ? [sixelFor(raster, cols, rows, {w: sx, h: sy})]
			: backend === 'braille' ? encodeBraille(raster, cols, rows) : encodeHalf(raster, cols, rows);
		times.push(performance.now() - started);
		bytes = out.reduce((sum, line) => sum + line.length, 0);
	}
	times.sort((a, b) => a - b);
	console.log(`${backend.padEnd(8)} ${cols}x${rows} cells, raster ${cols * sx}x${rows * sy}: median ${times[7]!.toFixed(1)} ms, worst ${times.at(-1)!.toFixed(1)} ms, ${(bytes / 1024).toFixed(0)} KB per frame`);
}

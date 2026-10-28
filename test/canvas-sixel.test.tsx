import {expect, test} from 'bun:test';
import {encodeSixel, quantize} from '../src/kit/canvas/sixel.js';
import {sixelFor} from '../src/kit/graphics.js';
import {Box, Canvas, Image, Text, useKeys, useState, type Bitmap, type Caps} from '../src/kit/index.js';
import {headless, TEST_CAPS} from '../src/kit/testing.js';

const ESC = '\u001B';

/** A minimal sixel decoder: RGBA pixels, alpha 0 where nothing was drawn. */
function decodeSixel(text: string): {width: number; height: number; data: Uint8ClampedArray; transparent: boolean} {
	const match = /^\u001BP([\d;]*)q([\s\S]*)\u001B\\$/.exec(text);
	if (!match) throw new Error('not a sixel DCS');
	const transparent = match[1]!.split(';')[1] === '1';
	const body = match[2]!;
	let i = 0;
	const number = () => {
		const start = i;
		while (i < body.length && /\d/.test(body[i]!)) i++;
		return Number(body.slice(start, i) || '0');
	};
	const numbers = () => {
		const list = [number()];
		while (body[i] === ';') {
			i++;
			list.push(number());
		}
		return list;
	};
	let width = 0;
	let height = 0;
	if (body[i] === '"') {
		i++;
		[, , width = 0, height = 0] = numbers();
	}
	const data = new Uint8ClampedArray(width * height * 4);
	const colors = new Map<number, [number, number, number]>();
	let color = 0;
	let x = 0;
	let band = 0;
	const paint = (char: number, count: number) => {
		const value = char - 63;
		const rgb = colors.get(color) ?? [0, 0, 0];
		for (let n = 0; n < count; n++, x++) {
			for (let bit = 0; bit < 6; bit++) {
				const y = band * 6 + bit;
				if (!(value & (1 << bit)) || x >= width || y >= height) continue;
				data.set([...rgb, 255], (y * width + x) * 4);
			}
		}
	};
	while (i < body.length) {
		const char = body[i]!;
		if (char === '#') {
			i++;
			const [index = 0, space, r = 0, g = 0, b = 0] = numbers();
			if (space === 2) colors.set(index, [Math.round(r * 2.55), Math.round(g * 2.55), Math.round(b * 2.55)]);
			color = index;
		} else if (char === '!') {
			i++;
			const count = number();
			paint(body.charCodeAt(i++), count);
		} else if (char === '$') {
			i++;
			x = 0;
		} else if (char === '-') {
			i++;
			x = 0;
			band++;
		} else {
			const code = body.charCodeAt(i++);
			if (code < 63 || code > 126) throw new Error(`unexpected ${JSON.stringify(char)}`);
			paint(code, 1);
		}
	}
	return {width, height, data, transparent};
}

function bitmap(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Bitmap {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
	return {width, height, data};
}

/** Mean and max absolute channel error over opaque pixels; also checks transparency matches. */
function compare(original: Bitmap, decoded: {data: Uint8ClampedArray}) {
	let sum = 0;
	let max = 0;
	let count = 0;
	for (let p = 0; p < original.width * original.height; p++) {
		const opaque = original.data[p * 4 + 3]! >= 128;
		expect(decoded.data[p * 4 + 3]).toBe(opaque ? 255 : 0);
		if (!opaque) continue;
		for (let c = 0; c < 3; c++) {
			const error = Math.abs(original.data[p * 4 + c]! - decoded.data[p * 4 + c]!);
			sum += error;
			max = Math.max(max, error);
			count++;
		}
	}
	return {mean: sum / count, max};
}

const gradient = (width: number, height: number) =>
	bitmap(width, height, (x, y) => [Math.round((x * 255) / (width - 1)), Math.round((y * 255) / (height - 1)), Math.round(((x + y) * 255) / (width + height - 2)), 255]);

test('sixel round trip: few colors stay exact (within percent rounding), transparency kept', () => {
	const image = bitmap(23, 17, (x, y) => (x < 4 && y < 4 ? [0, 0, 0, 0] : x < 12 ? [255, 30, 60, 255] : y < 9 ? [10, 200, 90, 255] : [250, 250, 245, 255]));
	const text = encodeSixel(image);
	expect(text.startsWith(`${ESC}P0;1;0q"1;1;23;17`)).toBe(true);
	const decoded = decodeSixel(text);
	expect([decoded.width, decoded.height, decoded.transparent]).toEqual([23, 17, true]);
	expect(compare(image, decoded).max).toBeLessThanOrEqual(2);
	// No trailing graphics new line: the cursor stays on the last band.
	expect(text.endsWith(`-${ESC}\\`)).toBe(false);
});

test('sixel round trip: a gradient with thousands of colors is reduced to 256 by median cut', () => {
	const image = gradient(64, 40);
	const {palette} = quantize(image);
	expect(palette.length).toBe(256);
	const text = encodeSixel(image);
	expect(text.match(/#\d+;2;/g)?.length).toBe(256);
	const {mean, max} = compare(image, decodeSixel(text));
	expect(mean).toBeLessThan(5);
	expect(max).toBeLessThan(24);
});

test('sixel round trip: noise, a height that is not a multiple of 6, and a color limit', () => {
	let seed = 7;
	const random = () => ((seed = (seed * 1_103_515_245 + 12_345) & 0x7F_FF_FF_FF) >> 16) & 255;
	const noise = bitmap(32, 31, () => [random(), random(), random(), 255]);
	const decoded = decodeSixel(encodeSixel(noise));
	expect(decoded.height).toBe(31);
	expect(compare(noise, decoded).mean).toBeLessThan(12);
	const sixteen = encodeSixel(gradient(40, 13), 16);
	expect(sixteen.match(/#\d+;2;/g)?.length).toBe(16);
	expect(compare(gradient(40, 13), decodeSixel(sixteen)).mean).toBeLessThan(20);
});

test('sixel runs are compressed with !n', () => {
	const solid = bitmap(100, 6, () => [0, 0, 255, 255]);
	expect(encodeSixel(solid)).toContain('#0!100~');
	const decoded = decodeSixel(encodeSixel(solid));
	expect(compare(solid, decoded).max).toBe(0);
});

test('sixelFor cuts the height to a multiple of 6 and to the cells asked', () => {
	const image = gradient(20, 21);
	const decoded = decodeSixel(sixelFor(image, 5, 3, {w: 4, h: 7}));
	expect([decoded.width, decoded.height]).toEqual([20, 18]);
	expect(decodeSixel(sixelFor(image, 2, 2, {w: 4, h: 7})).width).toBe(8);
	expect(sixelFor(image, 5, 0, {w: 4, h: 7})).toBe('');
});

// Small cells keep the sixel output short.
const SIXEL_CAPS: Caps = {...TEST_CAPS, graphics: 'sixel', sixelDetected: true, cell: {w: 4, h: 6}};
const RED = bitmap(4, 4, () => [255, 0, 0, 255]);
const count = (text: string, part: string) => text.split(part).length - 1;
const DCS = `${ESC}P0;1;0q`;

function Scene({rows = 2}: {rows?: number}) {
	const [n, setN] = useState(0);
	const [shown, setShown] = useState(true);
	useKeys([
		{keys: 'x', desc: 'Count', run: () => setN(value => value + 1)},
		{keys: 'h', desc: 'Hide', run: () => setShown(value => !value)},
	]);
	return (
		<Box flexDirection="column">
			<Text>count {n}</Text>
			<Box>
				{shown ? <Image src={RED} width={5} height={rows} fit="fill" /> : <Box width={5} height={rows} />}
				<Text>side</Text>
			</Box>
		</Box>
	);
}

test('sixel Image: drawn at its cell after the frame, redrawn inside the next frame, not resent when idle', async () => {
	const app = await headless(<Scene />, {cols: 30, rows: 8, caps: SIXEL_CAPS});
	await app.settle(60);
	const first = app.output();
	// Row 2, column 1 (1-based): below the "count" line. 5 cells x 4 px, 2 rows x 6 px.
	expect(first).toContain(`${ESC}7${ESC}[2;1H${DCS}"1;1;20;12`);
	expect(count(first, DCS)).toBe(1);
	expect(decodeSixel(first.slice(first.indexOf(DCS), first.indexOf(`${ESC}\\`, first.indexOf(DCS)) + 2)).data.slice(0, 4)).toEqual(new Uint8ClampedArray([255, 0, 0, 255]));
	expect(app.screen()).toContain('count 0');

	await app.settle(80);
	expect(count(app.output(), DCS)).toBe(1);

	// A frame that changes other text may have cut through the image: it is drawn again before the frame ends.
	await app.press('x');
	expect(app.screen()).toContain('count 1');
	const after = app.output().slice(first.length);
	expect(count(after, DCS)).toBe(1);
	const sixel = after.indexOf(DCS);
	expect(after.lastIndexOf(`${ESC}[?2026h`, sixel)).toBeGreaterThan(-1);
	expect(after.indexOf(`${ESC}[?2026l`, sixel)).toBeGreaterThan(sixel);
	await app.exit();
});

test('sixel Image: removing it erases its cells, and nothing is drawn after the app exits', async () => {
	const app = await headless(<Scene />, {cols: 30, rows: 8, caps: SIXEL_CAPS});
	await app.settle(60);
	const before = app.output().length;
	await app.press('h');
	await app.settle(40);
	const after = app.output().slice(before);
	expect(after).toContain(`${ESC}[2;1H${ESC}[5X${ESC}[3;1H${ESC}[5X`);
	expect(count(after, DCS)).toBe(0);
	await app.press('h');
	await app.settle(40);
	expect(count(app.output().slice(before), DCS)).toBe(1);
	const end = app.output().length;
	await app.exit();
	expect(count(app.output().slice(end), DCS)).toBe(0);
});

test('sixel Image: kept off the last row so it cannot scroll the screen', async () => {
	// Rows 1-3 of a 4-row screen: only rows 1 and 2 are drawn, 12 px.
	const app = await headless(<Scene rows={3} />, {cols: 30, rows: 4, caps: SIXEL_CAPS});
	await app.settle(60);
	expect(app.output()).toContain(`${ESC}[2;1H${DCS}"1;1;20;12`);
	await app.exit();
});

test('Canvas sixel backend draws through the layer; without sixel caps it falls back to braille', async () => {
	const scene = (
		<Box flexDirection="column" height={6}>
			<Canvas backend="sixel" version={1} background={[255, 255, 255]} draw={(raster, {sx, sy}) => raster.line(0, 0, 10 * sx, 3 * sy, 1, [0, 0, 0])} />
		</Box>
	);
	const sixel = await headless(scene, {cols: 20, rows: 8, caps: SIXEL_CAPS});
	await sixel.settle(60);
	expect(sixel.output()).toContain(`${ESC}7${ESC}[1;1H${DCS}"1;1;80;36`);
	expect(sixel.screen()).not.toMatch(/[⠁-⣿]/);
	await sixel.exit();

	const text = await headless(scene, {cols: 20, rows: 8});
	await text.settle(60);
	expect(text.screen()).toMatch(/[⠁-⣿]/);
	expect(text.output()).not.toContain(DCS);
	await text.exit();
});

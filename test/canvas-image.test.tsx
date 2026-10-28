import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect, test} from 'bun:test';
import {encode as encodeJpeg} from 'jpeg-js';
import {PNG} from 'pngjs';
import {ansi256, blankBitmap, encodeHalfBitmap} from '../src/kit/canvas/bitmap.js';
import {Box, decodeImage, drawBitmap, fitRect, Image, loadImage, Raster, Text, useKeys, useState, type Bitmap, type Caps} from '../src/kit/index.js';
import {headless, TEST_CAPS} from '../src/kit/testing.js';

const ESC = '\u001B';

function bitmap(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Bitmap {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
	return {width, height, data};
}

const at = (image: Bitmap, x: number, y: number) => [...image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)];

const dir = mkdtempSync(join(tmpdir(), 'gui-kit-image-'));
const PATTERN = bitmap(8, 6, (x, y) => [x * 30, y * 40, 200, x === 0 && y === 0 ? 0 : 255]);

function writePng(name: string, image: Bitmap): string {
	const png = new PNG({width: image.width, height: image.height});
	png.data = Buffer.from(image.data);
	const path = join(dir, name);
	writeFileSync(path, PNG.sync.write(png));
	return path;
}

test('fitRect: contain letterboxes, cover crops the middle, fill stretches, aspect corrects', () => {
	expect(fitRect(200, 100, 50, 50, 'contain')).toEqual({dst: {x: 0, y: 12, w: 50, h: 25}, src: {x: 0, y: 0, w: 200, h: 100}});
	expect(fitRect(200, 100, 50, 50, 'cover')).toEqual({dst: {x: 0, y: 0, w: 50, h: 50}, src: {x: 50, y: 0, w: 100, h: 100}});
	expect(fitRect(200, 100, 50, 50, 'fill').dst).toEqual({x: 0, y: 0, w: 50, h: 50});
	// Pixels twice as wide as tall: a square image needs half as many columns as rows.
	expect(fitRect(100, 100, 80, 40, 'contain', 2).dst).toEqual({x: 30, y: 0, w: 20, h: 40});
});

test('drawBitmap: area-average downscale, nearest and bilinear upscale', () => {
	const stripes = bitmap(4, 2, x => (x % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
	const small = blankBitmap(2, 1);
	drawBitmap(small, stripes, {fit: 'fill'});
	expect(at(small, 0, 0)).toEqual([128, 128, 128, 255]);
	expect(at(small, 1, 0)).toEqual([128, 128, 128, 255]);

	const checker = bitmap(2, 2, (x, y) => ((x + y) % 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
	const big = blankBitmap(4, 4);
	drawBitmap(big, checker, {fit: 'fill', smooth: false});
	expect(at(big, 1, 1)).toEqual([0, 0, 255, 255]);
	expect(at(big, 2, 1)).toEqual([255, 0, 0, 255]);
	expect(at(big, 3, 3)).toEqual([0, 0, 255, 255]);

	const ramp = bitmap(2, 1, x => [x * 255, 0, 0, 255]);
	const wide = blankBitmap(4, 1);
	drawBitmap(wide, ramp, {fit: 'fill'});
	expect([0, 1, 2, 3].map(x => at(wide, x, 0)[0])).toEqual([0, 64, 191, 255]);
});

test('drawBitmap into a Raster: contain keeps the background around the image, alpha blends', () => {
	const raster = new Raster(10, 4, [250, 250, 245]);
	drawBitmap(raster, bitmap(2, 2, () => [0, 0, 0, 255]), {fit: 'contain'});
	expect(at(raster, 0, 0)).toEqual([250, 250, 245, 255]);
	expect(at(raster, 5, 2)).toEqual([0, 0, 0, 255]);
	expect(at(raster, 9, 3)).toEqual([250, 250, 245, 255]);
	const glass = new Raster(1, 1, [0, 0, 0]);
	drawBitmap(glass, bitmap(1, 1, () => [255, 255, 255, 128]), {fit: 'fill'});
	expect(at(glass, 0, 0)).toEqual([128, 128, 128, 255]);
});

test('loadImage decodes PNG (alpha kept) and JPEG files; other files fail with a clear error', async () => {
	const png = await loadImage(writePng('pattern.png', PATTERN));
	expect([png.width, png.height]).toEqual([8, 6]);
	expect([...png.data]).toEqual([...PATTERN.data]);

	const opaque = bitmap(16, 16, x => [x < 8 ? 220 : 20, 120, x < 8 ? 30 : 230, 255]);
	const jpegPath = join(dir, 'halves.jpg');
	writeFileSync(jpegPath, encodeJpeg({width: 16, height: 16, data: Buffer.from(opaque.data)}, 95).data);
	const jpeg = await loadImage(jpegPath);
	expect([jpeg.width, jpeg.height]).toEqual([16, 16]);
	for (const [x, y] of [[2, 2], [13, 13]] as const) {
		at(jpeg, x, y).slice(0, 3).forEach((value, c) => expect(Math.abs(value - at(opaque, x, y)[c]!)).toBeLessThan(12));
	}

	expect(() => decodeImage(new TextEncoder().encode('GIF89a...'))).toThrow('not a PNG or JPEG file');
	await expect(loadImage(join(dir, 'missing.png'))).rejects.toThrow();
});

test('half blocks: truecolor, 256 colors, and transparent pixels show the background', () => {
	const image = bitmap(2, 2, (x, y) => (x === 1 && y === 0 ? [0, 0, 0, 0] : [255, 0, 0, 255]));
	const [line] = encodeHalfBitmap(image, 2, 1, true);
	expect(line).toBe(`${ESC}[38;2;255;0;0;48;2;255;0;0m▀${ESC}[38;2;255;0;0;49m▄${ESC}[39;49m`);
	expect(encodeHalfBitmap(image, 2, 1, false)[0]).toContain('38;5;196;48;5;196m▀');
	expect(ansi256([255, 0, 0])).toBe(196);
	expect(ansi256([128, 128, 128])).toBe(244);
	expect(ansi256([0, 0, 0])).toBe(16);
});

test('Image from a PNG file draws half blocks, keeping the aspect ratio', async () => {
	const path = writePng('wide.png', bitmap(40, 20, () => [0, 128, 255, 255]));
	const app = await headless(<Box flexDirection="column"><Text>top</Text><Image src={path} width={20} height={10} /></Box>, {cols: 30, rows: 14});
	await app.settle(80);
	const lines = app.lines().slice(1, 11);
	// A 2:1 picture in 20x10 cells of 1:2, i.e. 20x20 square half-block pixels:
	// 20 wide, 10 tall, centered from pixel row 5, so it spans rows 2 (lower half) to 7 (upper half).
	expect(lines.map(line => (line.includes('▄') ? 'lower' : line.includes('▀') ? 'upper' : ''))).toEqual(['', '', 'lower', 'upper', 'upper', 'upper', 'upper', 'upper', '', '']);
	expect(lines[5]!.slice(0, 20)).toBe('▀'.repeat(20));
	expect(app.output()).toContain('38;2;0;128;255');
	await app.exit();
});

test('Image with only a width takes its height from the picture', async () => {
	const app = await headless(<Box flexDirection="column"><Image src={bitmap(40, 20, () => [255, 255, 255, 255])} width={20} /><Text>below</Text></Box>, {cols: 30, rows: 14});
	await app.settle(40);
	// 2:1 picture in 20 columns of 1:2 cells: 5 rows.
	expect(app.lines().findIndex(line => line.includes('below'))).toBe(5);
	await app.exit();
});

test('Image without truecolor uses 256 colors', async () => {
	const app = await headless(<Image src={bitmap(4, 4, () => [255, 0, 0, 255])} width={4} height={2} fit="fill" />, {cols: 20, rows: 6, caps: {...TEST_CAPS, truecolor: false}});
	// Ink splits the style into one sequence per color.
	expect(app.output()).toContain(`${ESC}[38;5;196m${ESC}[48;5;196m▀▀▀▀`);
	expect(app.output()).not.toContain('38;2;255;0;0');
	await app.exit();
});

test('Image loading errors render a short message, not a crash', async () => {
	const notImage = join(dir, 'notes.txt');
	writeFileSync(notImage, 'hello');
	const app = await headless(
		<Box flexDirection="column">
			<Image src={join(dir, 'nope.png')} height={1} />
			<Image src={notImage} height={1} />
			<Image src={{width: 3, height: 3, data: new Uint8Array(4)}} height={1} />
		</Box>,
		{cols: 70, rows: 6},
	);
	await app.settle(60);
	expect(app.screen()).toContain('Cannot show image nope.png: file not found');
	expect(app.screen()).toContain('Cannot show image notes.txt: not a PNG or JPEG file');
	expect(app.screen()).toContain('Cannot show image invalid bitmap');
	expect(app.exited()).toBe(false);
	await app.exit();
});

test('Image with kitty graphics sends the scaled picture as PNG and leaves placeholders', async () => {
	const caps: Caps = {...TEST_CAPS, graphics: 'kitty', kittyGraphicsDetected: true};
	function Toggle() {
		const [shown, setShown] = useState(true);
		useKeys([{keys: 'h', desc: 'Hide', run: () => setShown(false)}]);
		return shown ? <Image src={PATTERN} width={6} height={3} fit="fill" /> : <Text>gone</Text>;
	}
	const app = await headless(<Toggle />, {cols: 20, rows: 6, caps});
	await app.settle(40);
	const out = app.output();
	expect(out).toContain(`${ESC}_Ga=T,U=1,f=100,q=2,i=`);
	expect(out).not.toContain('o=z');
	expect(app.screen()).toContain(String.fromCodePoint(0x10_EE_EE));
	// The payload is a valid PNG of 6x3 cells at 10x20 pixels (no reported cell size).
	const payload = [...out.matchAll(/\u001B_G[^;]*;([^\u001B]*)\u001B\\/g)].map(match => match[1]).join('');
	const png = PNG.sync.read(Buffer.from(payload, 'base64'));
	expect([png.width, png.height]).toEqual([60, 60]);
	// Unmounted while the app runs, it frees its image (on exit, run() frees them all).
	await app.press('h');
	expect(app.output()).toContain(`${ESC}_Ga=d,d=I,i=`);
	await app.exit();
});

/** The JPEG with an APP1 Exif segment whose IFD0 holds only Orientation; after SOI or after the APP0 that follows it. */
function withOrientation(jpeg: Uint8Array, orientation: number, little: boolean, afterApp0: boolean): Uint8Array {
	const tiff = Buffer.alloc(26);
	const u16 = (value: number, offset: number) => (little ? tiff.writeUInt16LE(value, offset) : tiff.writeUInt16BE(value, offset));
	const u32 = (value: number, offset: number) => (little ? tiff.writeUInt32LE(value, offset) : tiff.writeUInt32BE(value, offset));
	tiff.write(little ? 'II' : 'MM', 0, 'ascii');
	u16(42, 2);
	u32(8, 4);
	u16(1, 8);
	// Tag 0x0112, SHORT, count 1, the value left-aligned in its 4 bytes; then no next IFD.
	u16(0x01_12, 10);
	u16(3, 12);
	u32(1, 14);
	u16(orientation, 18);
	u32(0, 22);
	const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
	const head = Buffer.from([0xFF, 0xE1, 0, 0]);
	head.writeUInt16BE(body.length + 2, 2);
	const bytes = Buffer.from(jpeg);
	expect([bytes[2], bytes[3]]).toEqual([0xFF, 0xE0]);
	const at = afterApp0 ? 4 + bytes.readUInt16BE(4) : 2;
	return Buffer.concat([bytes.subarray(0, at), head, body, bytes.subarray(at)]);
}

test('JPEG EXIF orientation: all eight are turned upright, 5 to 8 swap width and height', () => {
	const colors = {TL: [230, 30, 30], TR: [30, 200, 30], BL: [30, 30, 230], BR: [240, 240, 240]} as const;
	type Corner = keyof typeof colors;
	// A 32x16 photo in four flat quadrants, as stored.
	const stored = bitmap(32, 16, (x, y) => [...colors[`${y < 8 ? 'T' : 'B'}${x < 16 ? 'L' : 'R'}` as Corner], 255] as [number, number, number, number]);
	const jpeg = encodeJpeg({width: 32, height: 16, data: Buffer.from(stored.data)}, 95).data;
	// What shows at the upright picture's top left, top right, bottom left and bottom right, per the EXIF meaning of each value.
	const upright: Record<number, [Corner, Corner, Corner, Corner]> = {
		1: ['TL', 'TR', 'BL', 'BR'],
		2: ['TR', 'TL', 'BR', 'BL'],
		3: ['BR', 'BL', 'TR', 'TL'],
		4: ['BL', 'BR', 'TL', 'TR'],
		5: ['TL', 'BL', 'TR', 'BR'],
		6: ['BL', 'TL', 'BR', 'TR'],
		7: ['BR', 'TR', 'BL', 'TL'],
		8: ['TR', 'BR', 'TL', 'BL'],
	};
	for (const [value, corners] of Object.entries(upright)) {
		const orientation = Number(value);
		for (const [little, afterApp0] of [[true, false], [false, true]] as const) {
			const image = decodeImage(withOrientation(jpeg, orientation, little, afterApp0));
			expect([image.width, image.height]).toEqual(orientation >= 5 ? [16, 32] : [32, 16]);
			const [w, h] = [image.width, image.height];
			const samples = [[w / 4, h / 4], [(3 * w) / 4, h / 4], [w / 4, (3 * h) / 4], [(3 * w) / 4, (3 * h) / 4]] as const;
			samples.forEach(([x, y], index) => {
				const pixel = at(image, x, y);
				colors[corners[index]!].forEach((value, c) => expect(Math.abs(pixel[c]! - value)).toBeLessThan(40));
			});
		}
	}
});

test('JPEG EXIF orientation: a broken or missing Exif segment leaves the picture as stored', () => {
	const jpeg = Buffer.from(encodeJpeg({width: 16, height: 8, data: Buffer.alloc(16 * 8 * 4, 128)}, 90).data);
	expect([decodeImage(jpeg).width, decodeImage(jpeg).height]).toEqual([16, 8]);
	const exif = withOrientation(jpeg, 6, true, false);
	expect(decodeImage(exif).width).toBe(8);
	// IFD0 offset pointing past the segment, an unknown byte order, a value out of range.
	const far = Buffer.from(exif);
	far.writeUInt32LE(9999, 2 + 4 + 6 + 4);
	const order = Buffer.from(exif);
	order.write('XX', 2 + 4 + 6, 'latin1');
	for (const bytes of [far, order, withOrientation(jpeg, 9, true, false), withOrientation(jpeg, 0, false, true)]) {
		expect([decodeImage(bytes).width, decodeImage(bytes).height]).toEqual([16, 8]);
	}
});

test('Image of a portrait photo stored sideways takes a portrait box', async () => {
	const path = join(dir, 'portrait.jpg');
	writeFileSync(path, withOrientation(encodeJpeg({width: 40, height: 20, data: Buffer.alloc(40 * 20 * 4, 200)}, 90).data, 6, false, true));
	const app = await headless(<Box flexDirection="column"><Image src={path} width={10} /><Text>below</Text></Box>, {cols: 30, rows: 30});
	await app.settle(80);
	// Upright it is 20x40, i.e. 1:2: 10 columns of 1:2 cells make 10 rows.
	expect(app.lines().findIndex(line => line.includes('below'))).toBe(10);
	await app.exit();
});

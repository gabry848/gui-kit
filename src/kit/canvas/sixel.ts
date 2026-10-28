// Sixel images for terminals without kitty graphics. Colors are reduced to
// at most 256 by median cut (an image with fewer colors keeps them exactly),
// transparent pixels are left untouched (P2=1), and runs of the same sixel
// are compressed with `!n`.

import type {Bitmap} from './bitmap.js';
import type {RGB} from './raster.js';

/** Pixels with less alpha than this are transparent. */
const OPAQUE = 128;

/** A palette of at most `maxColors` and each pixel's index in it, -1 for transparent. */
export function quantize(bitmap: Bitmap, maxColors = 256): {palette: RGB[]; indices: Int16Array} {
	const {data} = bitmap;
	const count = bitmap.width * bitmap.height;
	const indices = new Int16Array(count).fill(-1);

	// Few colors, as in a canvas: keep them exactly.
	const exact = new Map<number, number>();
	for (let p = 0; p < count && exact.size <= maxColors; p++) {
		if (data[p * 4 + 3]! < OPAQUE) continue;
		const key = (data[p * 4]! << 16) | (data[p * 4 + 1]! << 8) | data[p * 4 + 2]!;
		let index = exact.get(key);
		if (index === undefined) exact.set(key, (index = exact.size));
		indices[p] = index;
	}
	if (exact.size <= maxColors) {
		return {palette: [...exact.keys()].map(key => [key >> 16, (key >> 8) & 0xFF, key & 0xFF] as const), indices};
	}

	// Median cut over a 5-bit-per-channel histogram.
	const bins = new Uint32Array(32_768);
	const sums = new Float64Array(32_768 * 3);
	const binOf = new Uint16Array(count);
	for (let p = 0; p < count; p++) {
		if (data[p * 4 + 3]! < OPAQUE) continue;
		const r = data[p * 4]!;
		const g = data[p * 4 + 1]!;
		const b = data[p * 4 + 2]!;
		const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
		binOf[p] = bin;
		bins[bin]!++;
		sums[bin * 3]! += r;
		sums[bin * 3 + 1]! += g;
		sums[bin * 3 + 2]! += b;
	}
	const channel = (bin: number, c: number) => (bin >> (10 - c * 5)) & 31;
	type Box = {bins: number[]; pixels: number; range: number; axis: number};
	const makeBox = (members: number[]): Box => {
		let pixels = 0;
		let range = -1;
		let axis = 0;
		for (let c = 0; c < 3; c++) {
			let low = 31;
			let high = 0;
			for (const bin of members) {
				const v = channel(bin, c);
				if (v < low) low = v;
				if (v > high) high = v;
			}
			if (high - low > range) [range, axis] = [high - low, c];
		}
		for (const bin of members) pixels += bins[bin]!;
		return {bins: members, pixels, range, axis};
	};
	const occupied: number[] = [];
	for (let bin = 0; bin < bins.length; bin++) if (bins[bin]) occupied.push(bin);
	const boxes = [makeBox(occupied)];
	while (boxes.length < maxColors) {
		// Split the box with the most pixels times spread, at its median pixel.
		let best = -1;
		let score = 0;
		boxes.forEach((box, index) => {
			const value = box.range * box.pixels;
			if (box.bins.length > 1 && value > score) [best, score] = [index, value];
		});
		if (best < 0) break;
		const box = boxes[best]!;
		box.bins.sort((a, b) => channel(a, box.axis) - channel(b, box.axis));
		let seen = 0;
		let cut = 1;
		for (; cut < box.bins.length; cut++) {
			seen += bins[box.bins[cut - 1]!]!;
			if (seen * 2 >= box.pixels) break;
		}
		cut = Math.min(cut, box.bins.length - 1);
		boxes.splice(best, 1, makeBox(box.bins.slice(0, cut)), makeBox(box.bins.slice(cut)));
	}
	const palette: RGB[] = boxes.map(box => {
		let r = 0;
		let g = 0;
		let b = 0;
		for (const bin of box.bins) {
			r += sums[bin * 3]!;
			g += sums[bin * 3 + 1]!;
			b += sums[bin * 3 + 2]!;
		}
		return [Math.round(r / box.pixels), Math.round(g / box.pixels), Math.round(b / box.pixels)] as const;
	});
	// Each bin takes the palette color nearest to its average.
	const nearest = new Int16Array(32_768);
	for (const bin of occupied) {
		const r = sums[bin * 3]! / bins[bin]!;
		const g = sums[bin * 3 + 1]! / bins[bin]!;
		const b = sums[bin * 3 + 2]! / bins[bin]!;
		let best = 0;
		let distance = Infinity;
		palette.forEach(([pr, pg, pb], index) => {
			const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
			if (d < distance) [best, distance] = [index, d];
		});
		nearest[bin] = best;
	}
	for (let p = 0; p < count; p++) {
		if (data[p * 4 + 3]! >= OPAQUE) indices[p] = nearest[binOf[p]!]!;
	}
	return {palette, indices};
}

const percent = (v: number) => Math.round((v * 100) / 255);

/** `count` copies of sixel `char`, run-length encoded when that is shorter. */
function run(char: number, count: number): string {
	const text = String.fromCharCode(char);
	return count > 3 ? `!${count}${text}` : text.repeat(count);
}

/**
 * The bitmap as one sixel image (DCS ... ST), drawn at the cursor, 1:1
 * pixels. Pixels with alpha below 128 are not drawn. There is no trailing
 * graphics new line, so the cursor stays on the image's last band.
 */
export function encodeSixel(bitmap: Bitmap, maxColors = 256): string {
	const {width, height} = bitmap;
	const {palette, indices} = quantize(bitmap, maxColors);
	const parts = [`\u001BP0;1;0q"1;1;${width};${height}`];
	palette.forEach(([r, g, b], index) => parts.push(`#${index};2;${percent(r)};${percent(g)};${percent(b)}`));
	// Sixel bits per color and column for the current band, and each color's span.
	const bits = new Uint8Array(palette.length * width);
	const low = new Int32Array(palette.length).fill(-1);
	const high = new Int32Array(palette.length);
	for (let top = 0; top < height; top += 6) {
		const present: number[] = [];
		for (let dy = 0; dy < 6 && top + dy < height; dy++) {
			const row = (top + dy) * width;
			for (let x = 0; x < width; x++) {
				const color = indices[row + x]!;
				if (color < 0) continue;
				if (low[color] === -1) {
					present.push(color);
					low[color] = x;
					high[color] = x;
				} else if (x > high[color]!) {
					high[color] = x;
				} else if (x < low[color]!) {
					low[color] = x;
				}
				bits[color * width + x]! |= 1 << dy;
			}
		}
		const lines: string[] = [];
		for (const color of present) {
			let line = `#${color}`;
			const from = low[color]!;
			const to = high[color]!;
			if (from > 0) line += run(63, from);
			let x = from;
			while (x <= to) {
				const value = bits[color * width + x]!;
				let end = x + 1;
				while (end <= to && bits[color * width + end] === value) end++;
				line += run(63 + value, end - x);
				x = end;
			}
			bits.fill(0, color * width + from, color * width + to + 1);
			low[color] = -1;
			lines.push(line);
		}
		parts.push(lines.join('$') + (top + 6 < height ? '-' : ''));
	}
	return parts.join('') + '\u001B\\';
}

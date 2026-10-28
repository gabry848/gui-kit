// RGBA bitmaps: decoding PNG and JPEG files, scaling one into a raster or a
// box, and drawing one as half blocks.

import {readFile} from 'node:fs/promises';
import {decode as decodeJpeg} from 'jpeg-js';
import {PNG} from 'pngjs';
import type {RGB} from './raster.js';

/** RGBA pixels row by row, 4 bytes each. A Raster is one too. */
export type Bitmap = {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8Array | Uint8ClampedArray;
};

/** contain: the whole image, letterboxed. cover: fills the box, cropped. fill: stretched. */
export type Fit = 'contain' | 'cover' | 'fill';

export type Rect = {x: number; y: number; w: number; h: number};

/** A transparent bitmap. */
export function blankBitmap(width: number, height: number): Bitmap {
	return {width, height, data: new Uint8ClampedArray(width * height * 4)};
}

export function isBitmap(value: unknown): value is Bitmap {
	const bitmap = value as Bitmap;
	return typeof bitmap === 'object' && bitmap !== null
		&& Number.isInteger(bitmap.width) && Number.isInteger(bitmap.height)
		&& bitmap.data?.length === bitmap.width * bitmap.height * 4;
}

/** Decodes a PNG or JPEG file's bytes. */
export function decodeImage(bytes: Uint8Array): Bitmap {
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
		const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
		return {width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength)};
	}
	if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
		const jpeg = decodeJpeg(bytes, {useTArray: true, formatAsRGBA: true});
		return {width: jpeg.width, height: jpeg.height, data: jpeg.data};
	}
	throw new Error('not a PNG or JPEG file');
}

export async function loadImage(path: string): Promise<Bitmap> {
	return decodeImage(await readFile(path));
}

/**
 * Where an image goes in a box: `dst` in box pixels and the part of the
 * image it shows, `src`. `aspect` is a box pixel's width over its height,
 * so images keep their shape on pixels that are not square.
 */
export function fitRect(srcW: number, srcH: number, boxW: number, boxH: number, fit: Fit, aspect = 1): {dst: Rect; src: Rect} {
	const full = {x: 0, y: 0, w: srcW, h: srcH};
	if (fit === 'fill' || srcW === 0 || srcH === 0) return {dst: {x: 0, y: 0, w: boxW, h: boxH}, src: full};
	// Scale from image pixels to box units, where a box pixel is `aspect` wide and 1 tall.
	const scale = (fit === 'contain' ? Math.min : Math.max)((boxW * aspect) / srcW, boxH / srcH);
	if (fit === 'contain') {
		const w = Math.min(boxW, Math.max(1, Math.round((srcW * scale) / aspect)));
		const h = Math.min(boxH, Math.max(1, Math.round(srcH * scale)));
		return {dst: {x: Math.floor((boxW - w) / 2), y: Math.floor((boxH - h) / 2), w, h}, src: full};
	}
	const w = (boxW * aspect) / scale;
	const h = boxH / scale;
	return {dst: {x: 0, y: 0, w: boxW, h: boxH}, src: {x: (srcW - w) / 2, y: (srcH - h) / 2, w, h}};
}

type Taps = {index: number; weight: number}[];

/**
 * Source pixels and weights for each destination pixel along one axis: an
 * area average when shrinking, bilinear or nearest when enlarging.
 */
function axisTaps(start: number, length: number, count: number, limit: number, smooth: boolean): Taps[] {
	const clamp = (index: number) => Math.min(limit - 1, Math.max(0, index));
	const scale = length / count;
	const out: Taps[] = [];
	for (let d = 0; d < count; d++) {
		const taps: Taps = [];
		if (scale > 1) {
			const from = start + d * scale;
			const to = from + scale;
			for (let s = Math.floor(from); s < Math.ceil(to); s++) {
				const weight = Math.min(to, s + 1) - Math.max(from, s);
				if (weight > 0) taps.push({index: clamp(s), weight: weight / scale});
			}
		} else if (smooth) {
			const center = start + (d + 0.5) * scale - 0.5;
			const s = Math.floor(center);
			const t = center - s;
			taps.push({index: clamp(s), weight: 1 - t}, {index: clamp(s + 1), weight: t});
		} else {
			taps.push({index: clamp(Math.floor(start + (d + 0.5) * scale)), weight: 1});
		}
		out.push(taps);
	}
	return out;
}

export type DrawOptions = {
	/** The area to fill, in target pixels; the whole target by default. */
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	fit?: Fit;
	/** Bilinear when enlarging (default); false for nearest, e.g. pixel art. */
	smooth?: boolean;
	/** A target pixel's width over its height, 1 for square pixels. */
	aspect?: number;
};

/**
 * Draws `src` scaled into `target` (a Raster or a Bitmap), blended over what
 * is there. Shrinking averages areas, so detail turns into the right color
 * instead of aliasing.
 */
export function drawBitmap(target: Bitmap, src: Bitmap, options: DrawOptions = {}) {
	const {x = 0, y = 0, width = target.width - x, height = target.height - y, fit = 'contain', smooth = true, aspect = 1} = options;
	if (width <= 0 || height <= 0 || src.width === 0 || src.height === 0) return;
	const {dst, src: from} = fitRect(src.width, src.height, width, height, fit, aspect);
	const columns = axisTaps(from.x, from.w, dst.w, src.width, smooth);
	const lines = axisTaps(from.y, from.h, dst.h, src.height, smooth);
	const out = target.data;
	const pixels = src.data;
	for (let dy = 0; dy < dst.h; dy++) {
		const ty = y + dst.y + dy;
		if (ty < 0 || ty >= target.height) continue;
		const rowTaps = lines[dy]!;
		for (let dx = 0; dx < dst.w; dx++) {
			const tx = x + dst.x + dx;
			if (tx < 0 || tx >= target.width) continue;
			// Premultiplied sums, so transparent pixels do not darken edges.
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (const row of rowTaps) {
				const base = row.index * src.width;
				for (const column of columns[dx]!) {
					const index = (base + column.index) * 4;
					const weight = row.weight * column.weight * pixels[index + 3]!;
					r += pixels[index]! * weight;
					g += pixels[index + 1]! * weight;
					b += pixels[index + 2]! * weight;
					a += weight;
				}
			}
			if (a <= 0) continue;
			const sa = Math.min(1, a / 255);
			const t = (ty * target.width + tx) * 4;
			const da = (out[t + 3]! / 255) * (1 - sa);
			const oa = sa + da;
			out[t] = Math.round((r / a) * (sa / oa) + out[t]! * (da / oa));
			out[t + 1] = Math.round((g / a) * (sa / oa) + out[t + 1]! * (da / oa));
			out[t + 2] = Math.round((b / a) * (sa / oa) + out[t + 2]! * (da / oa));
			out[t + 3] = Math.round(oa * 255);
		}
	}
}

const CUBE = [0, 95, 135, 175, 215, 255];

/** The nearest of the 240 fixed xterm-256 colors (6x6x6 cube and gray ramp). */
export function ansi256([r, g, b]: RGB): number {
	const level = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
	const [ri, gi, bi] = [level(r), level(g), level(b)];
	const cube = [CUBE[ri]!, CUBE[gi]!, CUBE[bi]!];
	const grayStep = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)));
	const gray = 8 + grayStep * 10;
	const distance = (c: number[]) => (r - c[0]!) ** 2 + (g - c[1]!) ** 2 + (b - c[2]!) ** 2;
	return distance([gray, gray, gray]) < distance(cube) ? 232 + grayStep : 16 + 36 * ri + 6 * gi + bi;
}

/**
 * A `cols` by `rows * 2` bitmap as half-block lines, one pixel per half
 * cell. Transparent pixels (alpha below 128) show the terminal background.
 */
export function encodeHalfBitmap(bitmap: Bitmap, cols: number, rows: number, truecolor: boolean): string[] {
	const color = (index: number, layer: 38 | 48) => {
		const rgb: RGB = [bitmap.data[index]!, bitmap.data[index + 1]!, bitmap.data[index + 2]!];
		return truecolor ? `${layer};2;${rgb.join(';')}` : `${layer};5;${ansi256(rgb)}`;
	};
	const lines: string[] = [];
	for (let row = 0; row < rows; row++) {
		let line = '';
		let last = '';
		for (let col = 0; col < cols; col++) {
			const top = ((row * 2) * bitmap.width + col) * 4;
			const bottom = top + bitmap.width * 4;
			const topOn = col < bitmap.width && row * 2 < bitmap.height && bitmap.data[top + 3]! >= 128;
			const bottomOn = col < bitmap.width && row * 2 + 1 < bitmap.height && bitmap.data[bottom + 3]! >= 128;
			let style: string;
			let char: string;
			if (topOn && bottomOn) [style, char] = [`${color(top, 38)};${color(bottom, 48)}`, '▀'];
			else if (topOn) [style, char] = [`${color(top, 38)};49`, '▀'];
			else if (bottomOn) [style, char] = [`${color(bottom, 38)};49`, '▄'];
			else [style, char] = ['39;49', ' '];
			if (style !== last) {
				line += `\u001B[${style}m`;
				last = style;
			}
			line += char;
		}
		lines.push(line + '\u001B[39;49m');
	}
	return lines;
}

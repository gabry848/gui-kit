// Turns a raster into terminal lines. Braille and half blocks are plain
// characters and work in any terminal; kitty sends real pixels and leaves
// placeholder characters in the text, so Ink diffs them like any other text.

import {deflateSync} from 'node:zlib';
import {DIACRITICS} from './diacritics.js';
import type {Raster, RGB} from './raster.js';

export type Backend = 'braille' | 'half' | 'kitty';

/** Raster pixels per terminal cell for each backend. */
export function pixelsPerCell(backend: Backend, cell?: {w: number; h: number}): {sx: number; sy: number} {
	if (backend === 'braille') return {sx: 2, sy: 4};
	if (backend === 'half') return {sx: 1, sy: 2};
	// Real pixels, capped so a full-screen canvas stays a few megabytes.
	const w = Math.min(cell?.w ?? 10, 10);
	const h = Math.min(cell?.h ?? 20, 20);
	return {sx: w, sy: h};
}

const fg = ([r, g, b]: RGB) => `\u001B[38;2;${r};${g};${b}m`;
const bg = ([r, g, b]: RGB) => `\u001B[48;2;${r};${g};${b}m`;
const RESET = '\u001B[39;49m';

// Dot bit for pixel (x, y) inside a 2x4 braille cell.
const BRAILLE_BITS = [
	[0x01, 0x08],
	[0x02, 0x10],
	[0x04, 0x20],
	[0x40, 0x80],
];

export function encodeBraille(raster: Raster, cols: number, rows: number): string[] {
	const lines: string[] = [];
	for (let row = 0; row < rows; row++) {
		let line = bg(raster.background);
		let lastColor = '';
		for (let col = 0; col < cols; col++) {
			let bits = 0;
			let r = 0;
			let g = 0;
			let b = 0;
			let lit = 0;
			for (let dy = 0; dy < 4; dy++) {
				for (let dx = 0; dx < 2; dx++) {
					const x = col * 2 + dx;
					const y = row * 4 + dy;
					if (!raster.isBackground(x, y)) {
						bits |= BRAILLE_BITS[dy]![dx]!;
						const pixel = raster.get(x, y);
						r += pixel[0];
						g += pixel[1];
						b += pixel[2];
						lit++;
					}
				}
			}
			if (bits === 0) {
				line += ' ';
				continue;
			}
			const color = fg([Math.round(r / lit), Math.round(g / lit), Math.round(b / lit)]);
			if (color !== lastColor) {
				line += color;
				lastColor = color;
			}
			line += String.fromCodePoint(0x2800 + bits);
		}
		lines.push(line + RESET);
	}
	return lines;
}

export function encodeHalf(raster: Raster, cols: number, rows: number): string[] {
	const lines: string[] = [];
	for (let row = 0; row < rows; row++) {
		let line = '';
		let last = '';
		for (let col = 0; col < cols; col++) {
			const style = fg(raster.get(col, row * 2)) + bg(raster.get(col, row * 2 + 1));
			if (style !== last) {
				line += style;
				last = style;
			}
			line += '▀';
		}
		lines.push(line + RESET);
	}
	return lines;
}

const PLACEHOLDER = String.fromCodePoint(0x10_EE_EE);
const CHUNK = 4096;

/** The escape sequence that uploads the raster as image `id`. */
export function kittyTransmit(raster: Raster, cols: number, rows: number, id: number): string {
	const payload = deflateSync(raster.data, {level: 1}).toString('base64');
	let out = '';
	for (let start = 0; start < payload.length; start += CHUNK) {
		const more = start + CHUNK < payload.length ? 1 : 0;
		const chunk = payload.slice(start, start + CHUNK);
		const head = start === 0
			? `a=T,U=1,f=32,o=z,q=2,i=${id},s=${raster.width},v=${raster.height},c=${cols},r=${rows},m=${more}`
			: `m=${more}`;
		out += `\u001B_G${head};${chunk}\u001B\\`;
	}
	return out;
}

/** Placeholder text for image `id` (1..255): every cell names its row and column. */
export function kittyPlaceholders(cols: number, rows: number, id: number): string[] {
	const lines: string[] = [];
	for (let row = 0; row < rows; row++) {
		let line = `\u001B[38;5;${id}m`;
		for (let col = 0; col < cols; col++) {
			line += PLACEHOLDER + String.fromCodePoint(DIACRITICS[row]!, DIACRITICS[col]!);
		}
		lines.push(line + '\u001B[39m');
	}
	return lines;
}

export const KITTY_MAX_CELLS = DIACRITICS.length;

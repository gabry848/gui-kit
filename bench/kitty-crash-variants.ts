// One kitty graphics variant per run, to narrow down the Ghostty crash.
// `bun bench/kitty-crash-variants.ts <log file> <variant>`

import {appendFileSync, closeSync, fsyncSync, openSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {DIACRITICS} from '../src/kit/canvas/diacritics.js';
import {Raster} from '../src/kit/canvas/raster.js';

const [logPath = 'variants.log', variant = 'A'] = process.argv.slice(2);
const log = (line: string) => {
	appendFileSync(logPath, `${new Date().toISOString()} ${variant} ${line}\n`);
	const fd = openSync(logPath, 'a');
	fsyncSync(fd);
	closeSync(fd);
};
const out = (data: string) => process.stdout.write(data);

type Format = 'rgba' | 'zlib' | 'png';

function crc32(bytes: Uint8Array): number {
	let crc = ~0;
	for (const byte of bytes) {
		crc ^= byte;
		for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xED_B8_83_20 & -(crc & 1));
	}
	return ~crc >>> 0;
}

function png(raster: Raster): Buffer {
	const chunk = (type: string, data: Uint8Array) => {
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const length = Buffer.alloc(4);
		length.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body));
		return Buffer.concat([length, body, crc]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(raster.width, 0);
	header.writeUInt32BE(raster.height, 4);
	header.set([8, 6, 0, 0, 0], 8);
	const stride = raster.width * 4;
	const scanlines = Buffer.alloc((stride + 1) * raster.height);
	for (let y = 0; y < raster.height; y++) {
		scanlines.set(raster.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(scanlines, {level: 1})),
		chunk('IEND', new Uint8Array()),
	]);
}

function transmit(w: number, h: number, c: number, r: number, id: number, format: Format | boolean, chunkSize = 4096): string {
	if (format === true) format = 'zlib';
	if (format === false) format = 'rgba';
	const raster = new Raster(w, h, [250, 250, 245]);
	raster.line(0, 0, w - 1, h - 1, 2, [40, 90, 220]);
	const bytes = format === 'zlib' ? deflateSync(raster.data, {level: 1}) : format === 'png' ? png(raster) : Buffer.from(raster.data);
	const payload = bytes.toString('base64');
	const kind = format === 'png' ? 'f=100' : format === 'zlib' ? 'f=32,o=z' : 'f=32';
	const size = format === 'png' ? '' : `s=${w},v=${h},`;
	let seq = '';
	for (let start = 0; start < payload.length; start += chunkSize) {
		const more = start + chunkSize < payload.length ? 1 : 0;
		const head = start === 0
			? `a=T,U=1,${kind},q=1,i=${id},${size}c=${c},r=${r},m=${more}`
			: `m=${more}`;
		seq += `\u001B_G${head};${payload.slice(start, start + chunkSize)}\u001B\\`;
	}
	return seq;
}

function placeholders(c: number, r: number, id: number, color: 'indexed' | 'rgb', top = 3): string {
	const fg = color === 'indexed' ? `\u001B[38;5;${id}m` : `\u001B[38;2;0;0;${id}m`;
	let seq = '';
	for (let row = 0; row < r; row++) {
		seq += `\u001B[${top + row};1H` + fg;
		for (let col = 0; col < c; col++) {
			seq += String.fromCodePoint(0x10_EE_EE, DIACRITICS[row]!, DIACRITICS[col]!);
		}
		seq += '\u001B[39m';
	}
	return seq;
}

const variants: Record<string, [string, () => string]> = {
	A: ['400x200 uncompressed, 40x10 placeholders', () => transmit(400, 200, 40, 10, 4, false) + placeholders(40, 10, 4, 'indexed')],
	B: ['400x200 zlib, transmit only', () => transmit(400, 200, 40, 10, 4, true)],
	C: ['400x200 zlib, 40x1 placeholders', () => transmit(400, 200, 40, 10, 4, true) + placeholders(40, 1, 4, 'indexed')],
	D: ['400x200 zlib, 2x2 placeholders', () => transmit(400, 200, 40, 10, 4, true) + placeholders(2, 2, 4, 'indexed')],
	E: ['20x20 zlib with c=40 r=10, 40x10 placeholders', () => transmit(20, 20, 40, 10, 4, true) + placeholders(40, 10, 4, 'indexed')],
	F: ['400x200 zlib, 40x10 placeholders, rgb color id', () => transmit(400, 200, 40, 10, 4, true) + placeholders(40, 10, 4, 'rgb')],
	G: ['400x200 zlib, 10x10 placeholders', () => transmit(400, 200, 40, 10, 4, true) + placeholders(10, 10, 4, 'indexed')],
	H: ['400x200 zlib, 1x2 placeholders (second row)', () => transmit(400, 200, 40, 10, 4, true) + placeholders(1, 2, 4, 'indexed')],
	I: ['20x20 zlib c=2 r=2, 2x2 placeholders', () => transmit(20, 20, 2, 2, 4, true) + placeholders(2, 2, 4, 'indexed')],
	J: ['400x200 zlib in one unchunked command', () => transmit(400, 200, 40, 10, 4, 'zlib', 1e9)],
	K: ['20x20 zlib split in 64-byte chunks', () => transmit(20, 20, 2, 2, 4, 'zlib', 64)],
	L: ['400x200 PNG, 4096-byte chunks, 40x10 placeholders', () => transmit(400, 200, 40, 10, 4, 'png') + placeholders(40, 10, 4, 'indexed')],
	M: ['2300x1400 PNG, 4096-byte chunks, 230x70 placeholders', () => transmit(2300, 1400, 230, 70, 4, 'png') + placeholders(230, 70, 4, 'indexed', 1)],
	N: ['2300x1400 uncompressed, 230x70 placeholders', () => transmit(2300, 1400, 230, 70, 4, 'rgba') + placeholders(230, 70, 4, 'indexed', 1)],
};

const [name, build] = variants[variant] ?? variants['A']!;
log(`begin: ${name}`);
out('\u001B[2J\u001B[H' + `variant ${variant}: ${name}`);
// q=1 asks only for errors; a reply naming i=4 without OK means it was rejected.
let replies = '';
if (process.stdin.isTTY) {
	process.stdin.setRawMode(true);
	process.stdin.on('data', chunk => (replies += chunk.toString()));
}
out(build());
await new Promise(resolve => setTimeout(resolve, 2500));
log(`ok, replies: ${JSON.stringify(replies)}`);
process.exit(0);

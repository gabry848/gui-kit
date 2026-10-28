// Images placed at a screen position, for sixel. Ink only draws text and
// owns the screen, so the layer sits between Ink and the terminal: it passes
// Ink's writes through and, at the end of every frame Ink writes, inside the
// same synchronized-output block, draws each image again, since the frame
// may have overwritten some of its cells. When Ink writes nothing and no
// image changed, nothing is sent.
//
// An image's box must be blank in Ink's text (the components render nothing
// there). That makes erasing a moved or removed image safe: the cells it
// covered hold spaces for Ink too. Erasing happens at the start of a frame,
// before Ink writes, so Ink's new text lands on top.

import {createContext, useContext} from 'react';
import type {DOMElement} from 'ink';
import type {Bitmap} from './canvas/bitmap.js';
import {encodeSixel} from './canvas/sixel.js';
import {absolutePosition} from './layout.js';

const BSU = '\u001B[?2026h';
const ESU = '\u001B[?2026l';
const ENTER_ALT = '\u001B[?1049h';
const LEAVE_ALT = '\u001B[?1049l';
const SAVE = '\u001B7';
const RESTORE = '\u001B8';

export type Placement = {
	/** The Ink box the image covers; its position is read at every frame. */
	node: DOMElement;
	/** `cols * cell.w` by `rows * cell.h` pixels. */
	bitmap: Bitmap;
	cols: number;
	rows: number;
	cell: {w: number; h: number};
	/** The bitmap already encoded with sixelFor, if the caller has it. */
	sixel?: string;
};

type Rect = {x: number; y: number; cols: number; rows: number};
type Entry = Placement & {encoded?: {cols: number; rows: number; data: string}; drawn: Rect | undefined; dirty: boolean};

/**
 * The first `cols` by `rows` cells of a bitmap as sixel. The height is cut
 * to a multiple of 6 pixels, so the last band never reaches the row below
 * the box, where it could move the cursor past the bottom and scroll.
 */
export function sixelFor(bitmap: Bitmap, cols: number, rows: number, cell: {w: number; h: number}): string {
	const width = Math.min(bitmap.width, cols * cell.w);
	const height = Math.floor(Math.min(bitmap.height, rows * cell.h) / 6) * 6;
	if (width <= 0 || height <= 0) return '';
	if (width === bitmap.width && height === bitmap.height) return encodeSixel(bitmap);
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		data.set(bitmap.data.subarray(y * bitmap.width * 4, (y * bitmap.width + width) * 4), y * width * 4);
	}
	return encodeSixel({width, height, data});
}

const same = (a: Rect | undefined, b: Rect | undefined) =>
	a === b || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.cols === b.cols && a.rows === b.rows);

export class GraphicsLayer {
	/** The stream to give Ink instead of the terminal. */
	readonly stream: NodeJS.WriteStream;
	private readonly entries = new Map<object, Entry>();
	/** Areas to erase: images that moved, changed or went away. */
	private stale: Rect[] = [];
	/** Ink wrote outside a frame, so every image may be damaged. */
	private damaged = false;
	private inFrame = false;
	private active = true;
	private scheduled: ReturnType<typeof setImmediate> | undefined;

	constructor(private readonly out: NodeJS.WriteStream, private readonly sync: boolean) {
		const write = this.write;
		this.stream = new Proxy(out, {
			get(target, property) {
				if (property === 'write') return write;
				const value: unknown = Reflect.get(target, property, target);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
	}

	/** Shows, replaces or (with undefined) removes the image under `key`. */
	show(key: object, placement: Placement | undefined) {
		const old = this.entries.get(key);
		if (old && placement && old.bitmap === placement.bitmap && old.node === placement.node) return;
		if (old?.drawn) this.stale.push(old.drawn);
		if (placement) this.entries.set(key, {...placement, drawn: undefined, dirty: true});
		else if (old) this.entries.delete(key);
		else return;
		this.schedule();
	}

	dispose() {
		this.active = false;
		if (this.scheduled) clearImmediate(this.scheduled);
		this.scheduled = undefined;
		this.entries.clear();
	}

	private readonly write = (data: unknown, ...rest: unknown[]): boolean => {
		const forward = (chunk: unknown) => (this.out.write as (...args: unknown[]) => boolean)(chunk, ...rest);
		const text = typeof data === 'string' ? data : '';
		if (text === BSU) {
			const ok = forward(data);
			this.inFrame = true;
			if (this.active) this.raw(this.erase());
			return ok;
		}
		if (text === ESU && this.inFrame) {
			this.inFrame = false;
			if (this.active) this.raw(this.draw(true));
			return forward(data);
		}
		if (text.includes(LEAVE_ALT)) {
			// The app's screen is gone (exit or suspend): draw nothing on the shell's.
			this.active = false;
			this.stale = [];
			for (const entry of this.entries.values()) entry.drawn = undefined;
		} else if (text.includes(ENTER_ALT)) {
			this.active = true;
			this.damaged = true;
		}
		if (!this.inFrame && this.active) {
			this.damaged = true;
			this.schedule();
		}
		return forward(data);
	};

	private schedule() {
		this.scheduled ??= setImmediate(() => this.flush());
	}

	/** Draws what changed outside Ink's frames, e.g. a new image. */
	private flush() {
		this.scheduled = undefined;
		if (!this.active || this.inFrame) return;
		const erase = this.erase();
		const draw = this.draw(this.damaged || erase !== '');
		this.damaged = false;
		if (!erase && !draw) return;
		this.raw((this.sync ? BSU : '') + erase + draw + (this.sync ? ESU : ''));
	}

	private raw(data: string) {
		if (data) this.out.write(data);
	}

	/** Where an image is on screen now, kept off the last row so it never scrolls the screen. */
	private rectOf(entry: Entry): Rect | undefined {
		if (!entry.node.yogaNode) return undefined;
		const {x, y} = absolutePosition(entry.node);
		const cols = Math.min(entry.cols, (this.out.columns || 80) - x);
		const rows = Math.min(entry.rows, (this.out.rows || 24) - 1 - y);
		return cols > 0 && rows > 0 ? {x, y, cols, rows} : undefined;
	}

	/** Blanks the cells of images that moved or went away. */
	private erase(): string {
		const rects = this.stale;
		this.stale = [];
		for (const entry of this.entries.values()) {
			if (entry.drawn && !same(entry.drawn, this.rectOf(entry))) {
				rects.push(entry.drawn);
				entry.drawn = undefined;
				entry.dirty = true;
			}
		}
		if (rects.length === 0) return '';
		let out = SAVE + '\u001B[m';
		for (const rect of rects) {
			for (let row = 0; row < rect.rows; row++) out += `\u001B[${rect.y + row + 1};${rect.x + 1}H\u001B[${rect.cols}X`;
		}
		return out + RESTORE;
	}

	/** Draws every image, or only those not on screen yet. */
	private draw(all: boolean): string {
		let out = '';
		for (const entry of this.entries.values()) {
			if (!all && !entry.dirty) continue;
			entry.dirty = false;
			const rect = this.rectOf(entry);
			entry.drawn = rect;
			if (!rect) continue;
			if (entry.encoded?.cols !== rect.cols || entry.encoded.rows !== rect.rows) {
				const whole = rect.cols === entry.cols && rect.rows === entry.rows && entry.sixel !== undefined;
				entry.encoded = {cols: rect.cols, rows: rect.rows, data: whole ? entry.sixel! : sixelFor(entry.bitmap, rect.cols, rect.rows, entry.cell)};
			}
			out += `\u001B[${rect.y + 1};${rect.x + 1}H` + entry.encoded.data;
		}
		return out ? SAVE + out + RESTORE : '';
	}
}

/** The sixel layer, present only when the app runs with graphics 'sixel'. */
export const GraphicsContext = createContext<GraphicsLayer | undefined>(undefined);

export function useGraphics(): GraphicsLayer | undefined {
	return useContext(GraphicsContext);
}

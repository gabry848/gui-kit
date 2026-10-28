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
// before Ink writes, so Ink's new text lands on top. A box that shrinks is
// seen in the frame that shrinks it, since its size is read from the layout.
// An image is cut like Ink cuts text: to the inside of every ancestor with
// overflow="hidden", and off the last row.
//
// Text Ink draws over an image's box from elsewhere, such as a popup or a
// toast, breaks that rule: the image would be drawn again on top of it. So
// whatever floats over the screen calls useGraphicsSuspend while it is
// shown. While any such call is active, each frame the layer finds what Ink
// draws after an image, in tree order, the order Ink paints in (text,
// borders, backgrounds), and hides the images that overlaps. An image inside
// the floating box comes after the box's own border and background, so it
// stays, and so do the images the box doesn't reach.

import {createContext, useContext, useInsertionEffect} from 'react';
import type {DOMElement} from 'ink';
import type {Bitmap} from './canvas/bitmap.js';
import {encodeSixel} from './canvas/sixel.js';

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
/** Where an image is drawn: the cells it shows, and the bitmap cell they start at. */
type Spot = Rect & {dx: number; dy: number};
type Entry = Placement & {
	/** The sixel for the spot `key` (cols, rows, dx, dy) names. */
	encoded?: {key: string; data: string};
	/** Where the image goes in the frame being drawn; undefined when it is hidden or cut away. */
	target: Spot | undefined;
	/** Where it is on screen now. */
	drawn: Spot | undefined;
};

/**
 * `cols` by `rows` cells of a bitmap as sixel, from the cell `dx`, `dy`
 * (0, 0 is the top-left corner). The height is cut to a multiple of 6
 * pixels, so the last band never reaches the row below the box, where it
 * could move the cursor past the bottom and scroll.
 */
export function sixelFor(bitmap: Bitmap, cols: number, rows: number, cell: {w: number; h: number}, dx = 0, dy = 0): string {
	const left = dx * cell.w;
	const top = dy * cell.h;
	const width = Math.min(bitmap.width - left, cols * cell.w);
	const height = Math.floor(Math.min(bitmap.height - top, rows * cell.h) / 6) * 6;
	if (width <= 0 || height <= 0 || left < 0 || top < 0) return '';
	if (left === 0 && top === 0 && width === bitmap.width && height === bitmap.height) return encodeSixel(bitmap);
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		const start = ((top + y) * bitmap.width + left) * 4;
		data.set(bitmap.data.subarray(start, start + width * 4), y * width * 4);
	}
	return encodeSixel({width, height, data});
}

const same = (a: Spot | undefined, b: Spot | undefined) =>
	a === b || (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.cols === b.cols && a.rows === b.rows && a.dx === b.dx && a.dy === b.dy);

/** A screen area in cells, x1 and y1 included, x2 and y2 not. */
type Area = {x1: number; y1: number; x2: number; y2: number};

const meet = (a: Area, b: Area): Area => ({x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), x2: Math.min(a.x2, b.x2), y2: Math.min(a.y2, b.y2)});
const empty = (a: Area) => a.x1 >= a.x2 || a.y1 >= a.y2;

/** Not laid out by Ink: display="none", or hidden by Suspense. */
const undisplayed = (node: DOMElement) => node.isHidden === true || node.style.display === 'none';

/** The border width on each side, as Ink gives it to Yoga. */
function borders(node: DOMElement) {
	const {style} = node;
	if (!style.borderStyle) return {left: 0, right: 0, top: 0, bottom: 0};
	return {left: style.borderLeft === false ? 0 : 1, right: style.borderRight === false ? 0 : 1, top: style.borderTop === false ? 0 : 1, bottom: style.borderBottom === false ? 0 : 1};
}

/** Ink's contentOffsetX/Y (scrolling): whole cells, anything else is 0. */
const offset = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0);

/** The area a box at x, y lets its children show in, as Ink clips them: inside its border on each axis with overflow 'hidden'. */
function clipOf(node: DOMElement, x: number, y: number, clip: Area): Area {
	const {style, yogaNode} = node;
	if (node.nodeName !== 'ink-box' || !yogaNode) return clip;
	const side = borders(node);
	let area = clip;
	if ((style.overflowX ?? style.overflow) === 'hidden') {
		area = meet(area, {x1: x + side.left, x2: x + yogaNode.getComputedWidth() - side.right, y1: -Infinity, y2: Infinity});
	}
	if ((style.overflowY ?? style.overflow) === 'hidden') {
		area = meet(area, {x1: -Infinity, x2: Infinity, y1: y + side.top, y2: y + yogaNode.getComputedHeight() - side.bottom});
	}
	return area;
}

/**
 * Where Ink puts a node on screen, and the area its ancestors let it show
 * in, worked out the way Ink's renderer does; undefined when it is not shown.
 */
function placeOf(node: DOMElement, screen: Area): {x: number; y: number; clip: Area} | undefined {
	const chain: DOMElement[] = [];
	for (let current: DOMElement | undefined = node; current; current = current.parentNode) chain.push(current);
	chain.reverse();
	let x = 0;
	let y = 0;
	let clip = screen;
	for (const [index, current] of chain.entries()) {
		if (!current.yogaNode || undisplayed(current)) return undefined;
		x += current.yogaNode.getComputedLeft();
		y += current.yogaNode.getComputedTop();
		if (index === chain.length - 1) break;
		clip = clipOf(current, x, y, clip);
		x -= offset(current.style.contentOffsetX);
		y -= offset(current.style.contentOffsetY);
	}
	return {x, y, clip};
}

const hasText = (node: DOMElement): boolean =>
	node.childNodes.some(child => (child.nodeName === '#text' ? child.nodeValue.length > 0 : hasText(child)));

/**
 * What Ink draws in a frame, in the order it draws it: the cells of every
 * text, border and background, cut as Ink cuts them. For each node in
 * `wanted`, `after` is the position in that order just past its subtree, so
 * the paint with an order from there on lands over it.
 */
function paintsOf(root: DOMElement, screen: Area, wanted: Set<DOMElement>) {
	const paints: Array<{order: number; area: Area}> = [];
	const after = new Map<DOMElement, number>();
	let order = 0;
	const visit = (node: DOMElement, offsetX: number, offsetY: number, clip: Area) => {
		const {yogaNode} = node;
		if (!yogaNode || node.internal_static || undisplayed(node)) return;
		const x = offsetX + yogaNode.getComputedLeft();
		const y = offsetY + yogaNode.getComputedTop();
		const width = yogaNode.getComputedWidth();
		const height = yogaNode.getComputedHeight();
		const at = order++;
		const paint = (area: Area) => {
			const cut = meet(area, clip);
			if (!empty(cut)) paints.push({order: at, area: cut});
		};
		if (node.nodeName === 'ink-text') {
			if (hasText(node)) paint({x1: x, y1: y, x2: x + width, y2: y + height});
		} else if (node.nodeName === 'ink-box' || node.nodeName === 'ink-root') {
			if (node.nodeName === 'ink-box') {
				const side = borders(node);
				if (node.style.backgroundColor) paint({x1: x + side.left, y1: y + side.top, x2: x + width - side.right, y2: y + height - side.bottom});
				if (side.top) paint({x1: x, y1: y, x2: x + width, y2: y + 1});
				if (side.bottom) paint({x1: x, y1: y + height - 1, x2: x + width, y2: y + height});
				if (side.left) paint({x1: x, y1: y, x2: x + 1, y2: y + height});
				if (side.right) paint({x1: x + width - 1, y1: y, x2: x + width, y2: y + height});
			}
			const inner = clipOf(node, x, y, clip);
			for (const child of node.childNodes) {
				if (child.nodeName !== '#text') visit(child, x - offset(node.style.contentOffsetX), y - offset(node.style.contentOffsetY), inner);
			}
		}
		if (wanted.has(node)) after.set(node, order);
	};
	visit(root, 0, 0, screen);
	return {paints, after};
}

const overlaps = (area: Area, rect: Rect) => area.x1 < rect.x + rect.cols && rect.x < area.x2 && area.y1 < rect.y + rect.rows && rect.y < area.y2;

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
	/** Open suspend() calls: while there are any, images under what Ink draws after them are hidden. */
	private covers = 0;
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
		if (placement) this.entries.set(key, {...placement, target: undefined, drawn: undefined});
		else if (old) this.entries.delete(key);
		else return;
		this.schedule();
	}

	/**
	 * Something floats over the screen until the returned function is
	 * called; calls nest. While any is open, every frame hides the images
	 * that what Ink draws after them overlaps: images under a popup, not
	 * those inside it or out of its reach. A hidden image is erased at the
	 * start of the frame, under Ink's text, so call it before Ink draws the
	 * cover, as useGraphicsSuspend does, and it is drawn again once uncovered.
	 */
	suspend(): () => void {
		this.covers++;
		this.schedule();
		let resumed = false;
		return () => {
			if (resumed) return;
			resumed = true;
			this.covers--;
			this.schedule();
		};
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

	private screen(): Area {
		return {x1: 0, y1: 0, x2: this.out.columns || 80, y2: this.out.rows || 24};
	}

	/**
	 * Where an image goes in the frame being drawn: its box as laid out now,
	 * which may be smaller than the bitmap until the component catches up,
	 * cut to its overflow="hidden" ancestors as Ink cuts text, and off the
	 * last row so it never scrolls the screen.
	 */
	private spotOf(entry: Entry): Spot | undefined {
		const yoga = entry.node.yogaNode;
		if (!yoga) return undefined;
		const screen = this.screen();
		const place = placeOf(entry.node, {...screen, y2: screen.y2 - 1});
		if (!place) return undefined;
		const {x, y} = place;
		const box = meet(place.clip, {
			x1: x,
			y1: y,
			x2: x + Math.min(entry.cols, Math.floor(yoga.getComputedWidth())),
			y2: y + Math.min(entry.rows, Math.floor(yoga.getComputedHeight())),
		});
		if (empty(box)) return undefined;
		return {x: box.x1, y: box.y1, cols: box.x2 - box.x1, rows: box.y2 - box.y1, dx: box.x1 - x, dy: box.y1 - y};
	}

	/** Sets each image's target for the frame being drawn, from the current layout. */
	private plan() {
		for (const entry of this.entries.values()) entry.target = this.spotOf(entry);
		if (this.covers === 0) return;
		// Something floats over the screen: hide the images it draws over.
		const shown = [...this.entries.values()].filter(entry => entry.target);
		let root: DOMElement | undefined;
		for (let node: DOMElement | undefined = shown[0]?.node; node; node = node.parentNode) root = node;
		if (!root || root.nodeName !== 'ink-root') return;
		const {paints, after} = paintsOf(root, this.screen(), new Set(shown.map(entry => entry.node)));
		for (const entry of shown) {
			const from = after.get(entry.node);
			if (from !== undefined && paints.some(paint => paint.order >= from && overlaps(paint.area, entry.target!))) entry.target = undefined;
		}
	}

	/** Blanks the cells of images that moved, went away or got covered. */
	private erase(): string {
		const rects: Rect[] = this.stale;
		this.stale = [];
		this.plan();
		for (const entry of this.entries.values()) {
			if (entry.drawn && !same(entry.drawn, entry.target)) {
				rects.push(entry.drawn);
				entry.drawn = undefined;
			}
		}
		if (rects.length === 0) return '';
		let out = SAVE + '\u001B[m';
		for (const rect of rects) {
			for (let row = 0; row < rect.rows; row++) out += `\u001B[${rect.y + row + 1};${rect.x + 1}H\u001B[${rect.cols}X`;
		}
		return out + RESTORE;
	}

	/** Draws every image with a target, or only those not on screen yet; erase() sets the targets. */
	private draw(all: boolean): string {
		let out = '';
		for (const entry of this.entries.values()) {
			const spot = entry.target;
			if (!spot || (!all && entry.drawn)) continue;
			entry.drawn = spot;
			const key = `${spot.cols},${spot.rows},${spot.dx},${spot.dy}`;
			if (entry.encoded?.key !== key) {
				const whole = spot.dx === 0 && spot.dy === 0 && spot.cols === entry.cols && spot.rows === entry.rows && entry.sixel !== undefined;
				entry.encoded = {key, data: whole ? entry.sixel! : sixelFor(entry.bitmap, spot.cols, spot.rows, entry.cell, spot.dx, spot.dy)};
			}
			out += `\u001B[${spot.y + 1};${spot.x + 1}H` + entry.encoded.data;
		}
		return out ? SAVE + out + RESTORE : '';
	}
}

/** The sixel layer, present only when the app runs with graphics 'sixel'. */
export const GraphicsContext = createContext<GraphicsLayer | undefined>(undefined);

export function useGraphics(): GraphicsLayer | undefined {
	return useContext(GraphicsContext);
}

/**
 * Hides the sixel images under what Ink draws while `active` is true, for
 * anything drawn over the screen: popups, dialogs, which-key, toasts.
 * Images inside the floating box stay, and so do the ones it doesn't
 * overlap. Kitty images need nothing, their placeholders are text that Ink
 * overwrites. Call it on every render, before any early return, with
 * whether the cover is shown.
 */
export function useGraphicsSuspend(active = true) {
	const layer = useGraphics();
	// Insertion effects run before Ink writes the frame of the same commit
	// (layout and passive effects run after it), so the images under the cover
	// are already hidden in the frame that draws it and back in the one that removes it.
	useInsertionEffect(() => (active && layer ? layer.suspend() : undefined), [layer, active]);
}

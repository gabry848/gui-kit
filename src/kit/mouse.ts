// SGR mouse reports (DEC 1006, optionally in pixels with 1016).

export type MouseEvent = {
	kind: 'down' | 'up' | 'drag' | 'move' | 'wheel';
	button: 'left' | 'middle' | 'right' | 'none';
	wheel?: 'up' | 'down';
	/** Cell column and row, 0-based. */
	x: number;
	y: number;
	/** Position inside the cell, 0..1, when the terminal reports pixels. */
	fx: number;
	fy: number;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
};

export function mouseOn(pixels: boolean): string {
	return '\u001B[?1000h\u001B[?1002h\u001B[?1006h' + (pixels ? '\u001B[?1016h' : '');
}

export const MOUSE_OFF = '\u001B[?1016l\u001B[?1006l\u001B[?1002l\u001B[?1000l';

// Ink's useInput strips the leading ESC, so the report arrives as `[<b;x;yM`.
const SGR = /^\u001B?\[<(\d+);(\d+);(\d+)([Mm])$/;

export function parseMouse(input: string, cell?: {w: number; h: number}): MouseEvent | undefined {
	const match = SGR.exec(input);
	if (!match) {
		return undefined;
	}
	const code = Number(match[1]);
	let col = Number(match[2]) - 1;
	let row = Number(match[3]) - 1;
	let fx = 0.5;
	let fy = 0.5;
	if (cell) {
		fx = (col % cell.w) / cell.w;
		fy = (row % cell.h) / cell.h;
		col = Math.floor(col / cell.w);
		row = Math.floor(row / cell.h);
	}
	const buttons = ['left', 'middle', 'right', 'none'] as const;
	const base = {
		x: col,
		y: row,
		fx,
		fy,
		shift: (code & 4) !== 0,
		alt: (code & 8) !== 0,
		ctrl: (code & 16) !== 0,
	};
	if (code & 64) {
		return {...base, kind: 'wheel', button: 'none', wheel: (code & 1) ? 'down' : 'up'};
	}
	const button = buttons[code & 3]!;
	if (code & 32) {
		return {...base, kind: button === 'none' ? 'move' : 'drag', button};
	}
	return {...base, kind: match[4] === 'M' ? 'down' : 'up', button};
}

import {expect, test} from 'bun:test';
import {encodeSixel, quantize} from '../src/kit/canvas/sixel.js';
import {sixelFor, useGraphicsSuspend} from '../src/kit/graphics.js';
import {Box, Canvas, Image, Modal, Shell, Split, Text, useKeys, useNotify, useState, type Bitmap, type Caps} from '../src/kit/index.js';
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

const BSU = `${ESC}[?2026h`;
const ESU = `${ESC}[?2026l`;

/** The frames (BSU ... ESU) in written bytes, each with the offsets of a marker and of every sixel image. */
function frames(bytes: string, marker: string) {
	return bytes.split(BSU).slice(1).map(frame => {
		const body = frame.slice(0, Math.max(0, frame.indexOf(ESU)));
		return {body, marker: body.indexOf(marker), sixels: [...body.matchAll(/\u001BP0;1;0q/g)].map(match => match.index)};
	});
}

test('sixel Image: a box that shrinks is erased under the frame that moves the text, not after it', async () => {
	function Shrink() {
		const [width, setWidth] = useState(10);
		const [height, setHeight] = useState(3);
		useKeys([
			{keys: 's', desc: 'Narrower', run: () => setWidth(5)},
			{keys: 'S', desc: 'Shorter', run: () => setHeight(1)},
		]);
		return (
			<Box flexDirection="column">
				<Box>
					<Image src={RED} width={width} height={height} fit="fill" />
					<Text>side text</Text>
				</Box>
				<Text>row below</Text>
			</Box>
		);
	}
	const app = await headless(<Shrink />, {cols: 40, rows: 10, caps: SIXEL_CAPS});
	await app.settle(80);
	expect(app.lines()[0]).toBe('          side text');
	const before = app.output().length;
	await app.press('s');
	await app.settle(80);
	// The text moved left into the old image's cells and stays there.
	expect(app.lines()[0]).toBe('     side text');
	// The old 10-column box is erased only inside a frame, before Ink's text.
	const after = app.output().slice(before);
	const outside = after.split(BSU).map(part => part.slice(part.indexOf(ESU) + 1)).join('');
	expect(outside).not.toContain(`${ESC}[10X`);
	expect(frames(after, 'side text').some(frame => frame.marker > frame.body.indexOf(`${ESC}[10X`) && frame.body.includes(`${ESC}[10X`))).toBe(true);

	// Shorter: the line below moves up into the image's old rows.
	await app.press('S');
	await app.settle(80);
	expect(app.lines()[0]).toBe('     side text');
	expect(app.lines()[1]).toBe('row below');
	await app.exit();
});

function Cover({text}: {text: string}) {
	useGraphicsSuspend();
	return (
		<Box position="absolute" marginTop={1} marginLeft={1} borderStyle="round" paddingX={1}>
			<Text>{text}</Text>
		</Box>
	);
}

test('useGraphicsSuspend: images are hidden in the frame that draws a cover and come back when it closes', async () => {
	function Covered() {
		const [open, setOpen] = useState(0);
		const [n, setN] = useState(0);
		useKeys([
			{keys: 'o', desc: 'Open one more', run: () => setOpen(value => value + 1)},
			{keys: 'c', desc: 'Close one', run: () => setOpen(value => Math.max(0, value - 1))},
			{keys: 'x', desc: 'Count', run: () => setN(value => value + 1)},
		]);
		return (
			<Box flexDirection="column">
				<Image src={RED} width={20} height={6} fit="fill" />
				<Text>count {n}</Text>
				{open > 0 ? <Cover text="first cover" /> : null}
				{open > 1 ? <Cover text="second cover" /> : null}
			</Box>
		);
	}
	const app = await headless(<Covered />, {cols: 30, rows: 10, caps: SIXEL_CAPS});
	await app.settle(80);
	expect(count(app.output(), DCS)).toBe(1);

	let mark = app.output().length;
	await app.press('o');
	expect(app.screen()).toContain('first cover');
	let written = app.output().slice(mark);
	// No image after the cover's text, and the image's cells are erased before it.
	expect(count(written, DCS)).toBe(0);
	const opening = frames(written, 'first cover').find(frame => frame.marker >= 0)!;
	expect(opening.body.indexOf(`${ESC}[1;1H${ESC}[20X`)).toBeGreaterThan(-1);
	expect(opening.body.indexOf(`${ESC}[1;1H${ESC}[20X`)).toBeLessThan(opening.marker);

	// Other frames while it is open draw no image either, and nesting keeps them hidden.
	mark = app.output().length;
	await app.press('x');
	await app.press('o');
	await app.press('c');
	expect(app.screen()).toContain('count 1');
	expect(app.screen()).toContain('first cover');
	expect(count(app.output().slice(mark), DCS)).toBe(0);

	// Closing the last one draws the image again.
	mark = app.output().length;
	await app.press('c');
	await app.settle(40);
	expect(app.screen()).not.toContain('cover');
	written = app.output().slice(mark);
	expect(count(written, DCS)).toBeGreaterThanOrEqual(1);
	expect(written).toContain(`${ESC}[1;1H${DCS}"1;1;80;36`);
	await app.exit();
});

test('useGraphicsSuspend(active) follows its argument while mounted, and does nothing without sixel', async () => {
	function Toggle() {
		const [shown, setShown] = useState(false);
		useKeys([{keys: 't', desc: 'Toggle', run: () => setShown(value => !value)}]);
		useGraphicsSuspend(shown);
		return (
			<Box flexDirection="column">
				<Image src={RED} width={5} height={2} fit="fill" />
				<Text>{shown ? 'shown' : 'none'}</Text>
				{shown ? <Box position="absolute" marginLeft={2}><Text>toast</Text></Box> : null}
			</Box>
		);
	}
	const app = await headless(<Toggle />, {cols: 20, rows: 6, caps: SIXEL_CAPS});
	await app.settle(80);
	let mark = app.output().length;
	await app.press('t');
	expect(app.screen()).toContain('toast');
	expect(app.output().slice(mark)).toContain(`${ESC}[1;1H${ESC}[5X`);
	expect(count(app.output().slice(mark), DCS)).toBe(0);
	mark = app.output().length;
	await app.press('t');
	await app.settle(40);
	expect(app.screen()).toContain('none');
	expect(count(app.output().slice(mark), DCS)).toBeGreaterThanOrEqual(1);
	await app.exit();

	// Half blocks are text: nothing to hide.
	const text = await headless(<Toggle />, {cols: 20, rows: 6});
	await text.press('t');
	expect(text.lines()[0]).toBe('▀▀toast');
	expect(text.lines()[1]).toBe('▀▀▀▀▀');
	await text.exit();
});

/** The written sixel images, each with its 1-based position and raster size in pixels. */
function sixels(bytes: string) {
	return [...bytes.matchAll(/\u001B\[(\d+);(\d+)H\u001BP0;1;0q"1;1;(\d+);(\d+)/g)].map(match => ({
		row: Number(match[1]),
		col: Number(match[2]),
		width: Number(match[3]),
		height: Number(match[4]),
		at: match.index,
	}));
}
const erased = (bytes: string, row: number, col: number, cols: number) => bytes.includes(`${ESC}[${row};${col}H${ESC}[${cols}X`);
// Made once: a new bitmap on every render would be a new image each time.
const RED4 = RED;
const GREEN4 = bitmap(4, 4, () => [0, 255, 0, 255]);
const BLUE4 = bitmap(4, 4, () => [0, 0, 255, 255]);

test('sixel: an Image inside a Modal is drawn over the dialog; only images under the dialog hide', async () => {
	function Preview() {
		const [open, setOpen] = useState(false);
		const [n, setN] = useState(0);
		useKeys([
			{keys: 'o', desc: 'Open', run: () => setOpen(true)},
			{keys: 'x', desc: 'Count', run: () => setN(value => value + 1)},
		]);
		return (
			<Box flexDirection="column">
				{/* Outside the dialog: top left, 6x2 cells, 24x12 px. */}
				<Image src={RED4} width={6} height={2} fit="fill" />
				{/* Under the dialog: 20x6 cells from column 16, row 3 (1-based), 80x36 px. */}
				<Box marginLeft={15}>
					<Image src={BLUE4} width={20} height={6} fit="fill" />
				</Box>
				{open ? (
					<Modal title="Preview" onClose={() => setOpen(false)} bindings={[{keys: 'x', desc: 'Count', run: () => setN(value => value + 1)}]}>
						<Image src={GREEN4} width={12} height={4} fit="fill" />
						<Text>{n > 0 ? 'counted' : 'waiting'}</Text>
					</Modal>
				) : null}
			</Box>
		);
	}
	const app = await headless(<Shell title="t"><Preview /></Shell>, {cols: 50, rows: 16, caps: SIXEL_CAPS});
	await app.settle(80);
	expect(sixels(app.output()).map(({row, col, width}) => [row, col, width])).toEqual([[1, 1, 24], [3, 16, 80]]);

	let mark = app.output().length;
	await app.press('o');
	await app.settle(80);
	const lines = app.lines();
	const title = lines.findIndex(line => line.includes('Preview'));
	expect(title).toBeGreaterThan(-1);
	let written = app.output().slice(mark);
	// The image under the dialog is erased before Ink draws the dialog; the one outside it stays.
	const opening = frames(written, 'Preview').find(frame => frame.marker >= 0)!;
	expect(opening.body.indexOf(`${ESC}[3;16H${ESC}[20X`)).toBeGreaterThan(-1);
	expect(opening.body.indexOf(`${ESC}[3;16H${ESC}[20X`)).toBeLessThan(opening.marker);
	expect(erased(written, 1, 1, 6)).toBe(false);
	// The image in the dialog is drawn: two rows below the title (a blank row between), 12x4 cells.
	const inside = sixels(written).filter(image => image.width === 48);
	expect(inside.length).toBeGreaterThanOrEqual(1);
	expect(inside[0]).toMatchObject({row: title + 3, col: lines[title]!.indexOf('Preview') + 1, height: 24});
	expect(sixels(written).some(image => image.width === 80)).toBe(false);

	// A frame while the dialog is open redraws the images it doesn't cover, after Ink's text.
	mark = app.output().length;
	await app.press('x');
	expect(app.screen()).toContain('counted');
	written = app.output().slice(mark);
	const frame = frames(written, 'counted').find(part => part.marker >= 0)!;
	const drawn = sixels(frame.body);
	expect(drawn.map(image => image.width).sort()).toEqual([24, 48]);
	expect(drawn.every(image => image.at > frame.marker)).toBe(true);

	// Closing it brings the covered image back.
	mark = app.output().length;
	await app.press('<Esc>');
	await app.settle(60);
	expect(app.screen()).not.toContain('Preview');
	expect(sixels(app.output().slice(mark)).some(image => image.width === 80 && image.row === 3 && image.col === 16)).toBe(true);
	await app.exit();
});

test('sixel: a toast or the which-key menu hides only the images it overlaps', async () => {
	function Board() {
		const notify = useNotify();
		useKeys([
			{keys: 'n', desc: 'Notify', run: () => notify('boom', {kind: 'error'})},
			{keys: 'gx', desc: 'Go x', run: () => {}},
			{keys: 'gy', desc: 'Go y', run: () => {}},
		]);
		return (
			<Box flexDirection="column">
				{/* Under the toast at the top right: columns 37-46, rows 1-3. */}
				<Box marginLeft={36}>
					<Image src={RED4} width={10} height={3} fit="fill" />
				</Box>
				{/* Clear of both: columns 1-10, rows 4-6. */}
				<Image src={GREEN4} width={10} height={3} fit="fill" />
				<Box height={3} />
				{/* Under the which-key menu at the bottom right: columns 31-48, rows 10-13. */}
				<Box marginLeft={30}>
					<Image src={BLUE4} width={18} height={4} fit="fill" />
				</Box>
			</Box>
		);
	}
	const app = await headless(<Shell title="t"><Board /></Shell>, {cols: 50, rows: 16, caps: SIXEL_CAPS});
	await app.settle(80);
	expect(sixels(app.output()).map(({row, col}) => [row, col])).toEqual([[1, 37], [4, 1], [10, 31]]);

	// An error toast stays until dismissed: only the image under it goes.
	let mark = app.output().length;
	await app.press('n');
	await app.settle(80);
	expect(app.lines()[1]).toContain('boom');
	let written = app.output().slice(mark);
	expect(erased(written, 1, 37, 10)).toBe(true);
	expect(erased(written, 4, 1, 10)).toBe(false);
	expect(erased(written, 10, 31, 18)).toBe(false);
	const toastFrame = frames(written, 'boom').find(frame => frame.marker >= 0)!;
	expect(sixels(toastFrame.body).map(({row, col}) => [row, col])).toEqual([[4, 1], [10, 31]]);
	mark = app.output().length;
	await app.press('<Esc>');
	await app.settle(60);
	expect(app.screen()).not.toContain('boom');
	expect(sixels(app.output().slice(mark)).some(image => image.row === 1 && image.col === 37)).toBe(true);

	// The which-key menu at the bottom right hides the image under it, not the others.
	mark = app.output().length;
	await app.press('g');
	await app.settle(40);
	expect(app.screen()).toContain('Go x');
	written = app.output().slice(mark);
	expect(erased(written, 10, 31, 18)).toBe(true);
	expect(erased(written, 1, 37, 10)).toBe(false);
	expect(erased(written, 4, 1, 10)).toBe(false);
	const menu = frames(written, 'Go x').find(frame => frame.marker >= 0)!;
	expect(sixels(menu.body).map(({row, col}) => [row, col])).toEqual([[1, 37], [4, 1]]);
	mark = app.output().length;
	await app.press('<Esc>');
	await app.settle(60);
	expect(app.screen()).not.toContain('Go x');
	expect(sixels(app.output().slice(mark)).some(image => image.row === 10 && image.col === 31)).toBe(true);
	await app.exit();
});

test('sixel: an image is cut to the inside of its overflow="hidden" ancestors, like Ink cuts text', async () => {
	// 120x30 px: with height 5 the width follows to 30 cells, wider than an 18-column pane.
	const wide = bitmap(120, 30, x => (x < 72 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
	const split = await headless(
		<Split panes={[() => <Image src={wide} height={5} />, () => <Text>RIGHT PANE TEXT</Text>]} />,
		{cols: 40, rows: 12, caps: SIXEL_CAPS},
	);
	await split.settle(80);
	// Inside the left pane's border: columns 2-19, 18 cells or 72 px, 5 rows or 30 px.
	expect(sixels(split.output()).map(({row, col, width, height}) => [row, col, width, height])).toEqual([[2, 2, 72, 30]]);
	expect(split.lines()[1]).toContain('│RIGHT PANE TEXT');
	await split.exit();

	// A 3-row bordered box shows one row of a 6-row image, and nothing reaches the line below it.
	const short = await headless(
		<Box flexDirection="column">
			<Box borderStyle="single" width={22} height={3} overflow="hidden">
				<Image src={RED} width={20} height={6} fit="fill" />
			</Box>
			<Text>BELOW THE BOX</Text>
		</Box>,
		{cols: 30, rows: 10, caps: SIXEL_CAPS},
	);
	await short.settle(80);
	expect(sixels(short.output()).map(({row, col, width, height}) => [row, col, width, height])).toEqual([[2, 2, 80, 6]]);
	await short.exit();
});

test('sixel: a clip that starts inside the image shows the matching part of the bitmap, re-encoded when it moves', async () => {
	// 5x6 cells of 4x6 px, one color per cell row; the Image's raster is the bitmap pixel for pixel.
	const band = (row: number): [number, number, number] => [40 * row, 200, 250 - 40 * row];
	const stripes = bitmap(20, 36, (_x, y) => [...band(Math.floor(y / 6)), 255]);
	function Scrolled() {
		const [scroll, setScroll] = useState(2);
		useKeys([{keys: 'k', desc: 'Up', run: () => setScroll(value => value - 1)}]);
		return (
			<Box flexDirection="column">
				<Text>scrolled {scroll}</Text>
				<Box height={4} overflow="hidden" flexDirection="column" contentOffsetY={scroll}>
					<Box flexShrink={0}>
						<Image src={stripes} width={5} height={6} fit="fill" smooth={false} />
					</Box>
				</Box>
				<Text>bottom</Text>
			</Box>
		);
	}
	const firstPixel = (bytes: string, from: number) => {
		const start = bytes.indexOf(DCS, from);
		const image = decodeSixel(bytes.slice(start, bytes.indexOf(`${ESC}\\`, start) + 2));
		return {width: image.width, height: image.height, rgb: [...image.data.slice(0, 3)]};
	};
	const close = (actual: number[], expected: number[]) => actual.every((value, index) => Math.abs(value - expected[index]!) <= 3);

	const app = await headless(<Scrolled />, {cols: 20, rows: 10, caps: SIXEL_CAPS});
	await app.settle(80);
	// Rows 2-5 of the screen show bitmap rows 2-5: placed at row 2, 4 rows (24 px), starting with band 2.
	let images = sixels(app.output());
	expect(images.map(({row, col, width, height}) => [row, col, width, height])).toEqual([[2, 1, 20, 24]]);
	let pixel = firstPixel(app.output(), images[0]!.at);
	expect(close(pixel.rgb, band(2))).toBe(true);

	// Scrolled up by one: same size on screen, now from band 1.
	const mark = app.output().length;
	await app.press('k');
	await app.settle(60);
	const written = app.output().slice(mark);
	images = sixels(written);
	expect(images.length).toBeGreaterThanOrEqual(1);
	expect(images.map(({row, col, width, height}) => [row, col, width, height])).toContainEqual([2, 1, 20, 24]);
	pixel = firstPixel(written, images.at(-1)!.at);
	expect(close(pixel.rgb, band(1))).toBe(true);
	await app.exit();
});

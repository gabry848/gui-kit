// Spike app: a searchable list with a modal and a drawing canvas, to try the
// kit's keys, mouse and graphics in a real terminal.

import {useRef, useState} from 'react';
import {Box, Text} from 'ink';
import {
	Canvas,
	List,
	Modal,
	Shell,
	theme,
	useCommand,
	useKeys,
	useKit,
	type Backend,
	type Pointer,
	type RGB,
} from '../../kit/index.js';

type Screen = 'list' | 'canvas';

export function Demo() {
	const [screen, setScreen] = useState<Screen>('list');
	const toggle = () => setScreen(current => (current === 'list' ? 'canvas' : 'list'));
	useKeys([
		{keys: '<Space>1', desc: 'Go to the list', group: 'Screens', run: () => setScreen('list')},
		{keys: '<Space>2', desc: 'Go to the canvas', group: 'Screens', run: () => setScreen('canvas')},
		{keys: 'gt', desc: 'Next screen', group: 'Screens', run: toggle},
		{keys: 'gT', desc: 'Previous screen', group: 'Screens', run: toggle},
	]);
	return (
		<Shell title={screen === 'list' ? 'Demo · List' : 'Demo · Canvas'}>
			<Tabs screen={screen} />
			{screen === 'list' ? <FileList /> : <Drawing />}
		</Shell>
	);
}

function Tabs({screen}: {screen: Screen}) {
	const tab = (id: Screen, label: string) => (
		<Text {...(screen === id ? {backgroundColor: theme.accent, color: theme.accentText} : {color: theme.muted})}>{` ${label} `}</Text>
	);
	return (
		<Box height={1} gap={1}>
			{tab('list', '1 List')}
			{tab('canvas', '2 Canvas')}
			<Text color={theme.muted}>  gt/gT or ␣1 ␣2 to switch</Text>
		</Box>
	);
}

type Item = {name: string; size: number; kind: string};

const KINDS = ['document', 'image', 'project', 'archive', 'note'];
const WORDS = ['budget', 'bottle', 'project', 'invoice', 'schema', 'render', 'photo', 'notes', 'contract', 'logo'];

function makeItems(count: number): Item[] {
	return Array.from({length: count}, (_, index) => ({
		name: `${WORDS[index % WORDS.length]}-${String(index + 1).padStart(3, '0')}`,
		size: ((index * 7919) % 9000) + 120,
		kind: KINDS[index % KINDS.length]!,
	}));
}

function FileList() {
	const [items, setItems] = useState(() => makeItems(500));
	const [open, setOpen] = useState<Item | undefined>();
	const {keymap} = useKit();
	const remove = (item: Item) => {
		setItems(current => current.filter(other => other !== item));
		setOpen(undefined);
		keymap.flash(`Deleted ${item.name}`);
	};
	return (
		<Box flexDirection="column" flexGrow={1}>
			<Box height={1}>
				<Text color={theme.muted}>{`  ${items.length} items · j/k move · / search · ⏎ open · click and wheel`}</Text>
			</Box>
			<List
				items={items}
				text={item => item.name}
				active={!open}
				onOpen={setOpen}
				render={(item, selected) => (
					<Box gap={2} flexGrow={1}>
						<Box width={18}><Text color={selected ? theme.text : theme.text} bold={selected}>{item.name}</Text></Box>
						<Box width={12}><Text color={theme.muted}>{item.kind}</Text></Box>
						<Text color={theme.muted}>{`${(item.size / 1000).toFixed(1)} MB`}</Text>
					</Box>
				)}
			/>
			{open ? (
				<Modal
					title={open.name}
					onClose={() => setOpen(undefined)}
					bindings={[{keys: 'dd', desc: 'Delete', group: 'Window', run: () => remove(open)}]}
				>
					<Text color={theme.text}>{`Type: ${open.kind}`}</Text>
					<Text color={theme.text}>{`Size: ${(open.size / 1000).toFixed(1)} MB`}</Text>
					<Box height={1} />
					<Text color={theme.muted}>dd delete · Esc close</Text>
				</Modal>
			) : null}
		</Box>
	);
}

type Tool = 'pen' | 'line' | 'rect' | 'ellipse' | 'eraser';
type Stroke = {tool: Tool; color: RGB; width: number; points: [number, number][]};

const COLORS: {name: string; rgb: RGB}[] = [
	{name: 'black', rgb: [30, 30, 40]},
	{name: 'blue', rgb: [40, 90, 220]},
	{name: 'red', rgb: [220, 50, 60]},
	{name: 'green', rgb: [40, 160, 80]},
	{name: 'orange', rgb: [240, 140, 30]},
];
const TOOL_LABEL: Record<Tool, string> = {pen: 'pen', line: 'line', rect: 'rectangle', ellipse: 'ellipse', eraser: 'eraser'};
const PAPER: RGB = [250, 250, 245];

function Drawing() {
	const {caps, keymap} = useKit();
	const backends: Backend[] = caps.graphics === 'kitty' ? ['kitty', 'braille', 'half'] : ['braille', 'half'];
	const [backend, setBackend] = useState<Backend>(backends[0]!);
	const [tool, setTool] = useState<Tool>('pen');
	const [color, setColor] = useState(0);
	const [width, setWidth] = useState(1);
	const [version, setVersion] = useState(0);
	const [stats, setStats] = useState({ms: 0, bytes: 0});
	const strokes = useRef<Stroke[]>([]);
	const undone = useRef<Stroke[]>([]);
	const current = useRef<Stroke | undefined>(undefined);
	const cursor = useRef({x: 10, y: 5, down: false});
	const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// Mouse drags arrive faster than frames; redraw at most every 16 ms.
	const redraw = () => {
		pending.current ??= setTimeout(() => {
			pending.current = undefined;
			setVersion(value => value + 1);
		}, 16);
	};

	const begin = (x: number, y: number) => {
		current.current = {tool, color: tool === 'eraser' ? PAPER : COLORS[color]!.rgb, width: tool === 'eraser' ? width + 3 : width, points: [[x, y]]};
		redraw();
	};
	const extend = (x: number, y: number) => {
		const stroke = current.current;
		if (!stroke) return;
		if (stroke.tool === 'pen' || stroke.tool === 'eraser') {
			stroke.points.push([x, y]);
		} else {
			stroke.points = [stroke.points[0]!, [x, y]];
		}
		redraw();
	};
	const commit = () => {
		if (current.current) {
			strokes.current.push(current.current);
			undone.current = [];
			current.current = undefined;
			redraw();
		}
	};

	const onPointer = (pointer: Pointer) => {
		if (pointer.kind === 'down' && pointer.button === 'left') begin(pointer.x, pointer.y);
		else if (pointer.kind === 'drag') extend(pointer.x, pointer.y);
		else if (pointer.kind === 'up') commit();
	};

	const moveCursor = (dx: number, dy: number) => {
		cursor.current.x = Math.max(0, cursor.current.x + dx);
		cursor.current.y = Math.max(0, cursor.current.y + dy);
		if (cursor.current.down) extend(cursor.current.x + 0.5, cursor.current.y + 0.5);
		redraw();
	};
	const togglePen = () => {
		if (cursor.current.down) {
			commit();
		} else {
			begin(cursor.current.x + 0.5, cursor.current.y + 0.5);
		}
		cursor.current.down = !cursor.current.down;
		redraw();
	};
	const undo = () => {
		const stroke = strokes.current.pop();
		if (stroke) undone.current.push(stroke);
		redraw();
	};
	const redo = () => {
		const stroke = undone.current.pop();
		if (stroke) strokes.current.push(stroke);
		redraw();
	};
	const clear = () => {
		strokes.current = [];
		undone.current = [];
		redraw();
	};

	useKeys([
		{keys: 'h', desc: 'Cursor left', group: 'Canvas', run: count => moveCursor(-count, 0)},
		{keys: 'l', desc: 'Cursor right', group: 'Canvas', run: count => moveCursor(count, 0)},
		{keys: 'j', desc: 'Cursor down', group: 'Canvas', run: count => moveCursor(0, count)},
		{keys: 'k', desc: 'Cursor up', group: 'Canvas', run: count => moveCursor(0, -count)},
		{keys: '<CR>', desc: 'Pen down/up at the cursor', group: 'Canvas', run: togglePen},
		{keys: 'tp', desc: 'Pen tool', group: 'Tools', run: () => setTool('pen')},
		{keys: 'tl', desc: 'Line tool', group: 'Tools', run: () => setTool('line')},
		{keys: 'tr', desc: 'Rectangle tool', group: 'Tools', run: () => setTool('rect')},
		{keys: 'to', desc: 'Ellipse tool', group: 'Tools', run: () => setTool('ellipse')},
		{keys: 'te', desc: 'Eraser tool', group: 'Tools', run: () => setTool('eraser')},
		{keys: 'c', desc: 'Next color', group: 'Tools', run: () => setColor(value => (value + 1) % COLORS.length)},
		{keys: '+', desc: 'Thicker stroke', group: 'Tools', run: () => setWidth(value => Math.min(4, value + 1))},
		{keys: '-', desc: 'Thinner stroke', group: 'Tools', run: () => setWidth(value => Math.max(1, value - 1))},
		{keys: 'u', desc: 'Undo', group: 'Canvas', run: count => Array.from({length: count}, undo)},
		{keys: '<C-r>', desc: 'Redo', group: 'Canvas', run: count => Array.from({length: count}, redo)},
		{keys: 'b', desc: 'Switch the graphics backend', group: 'Canvas', run: () => {
			setBackend(value => backends[(backends.indexOf(value) + 1) % backends.length]!);
			redraw();
		}},
	]);
	useCommand('clear', 'Clear the canvas', clear);
	useCommand('backend', 'Backend: braille, half or kitty', name => {
		if ((backends as string[]).includes(name)) setBackend(name as Backend);
		else keymap.flash(`Available backends: ${backends.join(', ')}`);
	});

	const draw = (raster: import('../../kit/index.js').Raster, {sx, sy}: {sx: number; sy: number}) => {
		const all = current.current ? [...strokes.current, current.current] : strokes.current;
		for (const stroke of all) {
			const radius = (stroke.width * Math.min(sx, sy)) / 6;
			const points = stroke.points.map(([x, y]) => [x * sx, y * sy] as const);
			const [first, last = first] = [points[0]!, points.at(-1)];
			if (stroke.tool === 'rect') raster.rect(first[0], first[1], last![0], last![1], radius, stroke.color);
			else if (stroke.tool === 'ellipse') raster.ellipse(first[0], first[1], last![0], last![1], radius, stroke.color);
			else if (stroke.tool === 'line') raster.line(first[0], first[1], last![0], last![1], radius, stroke.color);
			else {
				raster.dot(first[0], first[1], radius, stroke.color);
				for (let index = 1; index < points.length; index++) {
					raster.line(points[index - 1]![0], points[index - 1]![1], points[index]![0], points[index]![1], radius, stroke.color);
				}
			}
		}
		// Keyboard cursor: a small cross, red while the pen is down.
		const cx = (cursor.current.x + 0.5) * sx;
		const cy = (cursor.current.y + 0.5) * sy;
		const mark: RGB = cursor.current.down ? [220, 40, 40] : [150, 150, 170];
		raster.line(cx - sx, cy, cx + sx, cy, 0, mark);
		raster.line(cx, cy - sy, cx, cy + sy, 0, mark);
	};

	return (
		<Box flexDirection="column" flexGrow={1}>
			<Box height={1} gap={2}>
				<Text color={theme.text}>{` ${TOOL_LABEL[tool]}`}</Text>
				<Text color={`rgb(${COLORS[color]!.rgb.join(',')})`}>{`● ${COLORS[color]!.name}`}</Text>
				<Text color={theme.muted}>{`width ${width}`}</Text>
				<Text color={theme.accent}>{`backend ${backend}`}</Text>
				<Text color={theme.muted}>{`frame ${stats.ms.toFixed(1)} ms · ${(stats.bytes / 1024).toFixed(0)} KB`}</Text>
				<Text color={theme.muted}>{caps.sgrPixels ? 'mouse in pixels' : 'mouse in cells'}</Text>
			</Box>
			<Canvas
				backend={backend}
				version={version}
				draw={draw}
				background={PAPER}
				onPointer={onPointer}
				onFrame={(ms, bytes) => setStats({ms, bytes})}
			/>
		</Box>
	);
}


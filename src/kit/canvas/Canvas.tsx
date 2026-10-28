import {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useBoxMetrics, type DOMElement} from 'ink';
import {useKit, useMouse} from '../context.js';
import {sixelFor, useGraphics} from '../graphics.js';
import {absolutePosition} from '../layout.js';
import {
	encodeBraille,
	encodeHalf,
	KITTY_MAX_CELLS,
	kittyPlaceholders,
	kittyTransmit,
	nextKittyId,
	pixelsPerCell,
	type Backend,
} from './encode.js';
import {Raster, type RGB} from './raster.js';

export type Pointer = {
	kind: 'down' | 'up' | 'drag' | 'wheel';
	button: 'left' | 'middle' | 'right' | 'none';
	wheel?: 'up' | 'down';
	/** Position in cell units from the canvas' top-left corner. */
	x: number;
	y: number;
};

type Props = {
	backend: Backend;
	/** Change it to redraw. */
	version: number;
	/** Draws the scene; one cell unit is `sx` by `sy` raster pixels. */
	draw: (raster: Raster, scale: {sx: number; sy: number}) => void;
	background?: RGB;
	onPointer?: (pointer: Pointer) => void;
	/** Reports how long the last raster plus encode took. */
	onFrame?: (ms: number, bytes: number) => void;
};

export function Canvas({backend, version, draw, background = [250, 250, 245], onPointer, onFrame}: Props) {
	const ref = useRef<DOMElement>(null);
	const {width, height} = useBoxMetrics(ref);
	const {caps, write} = useKit();
	const layer = useGraphics();
	const [imageId] = useState(nextKittyId);
	const [key] = useState(() => ({}));
	// Pixels only where the probe allowed them (see Caps.graphics); otherwise
	// draw braille, which works anywhere.
	if (backend === 'kitty' && caps.graphics !== 'kitty') backend = 'braille';
	if (backend === 'sixel' && (caps.graphics !== 'sixel' || !caps.cell || !layer)) backend = 'braille';
	const kitty = backend === 'kitty';
	const sixel = backend === 'sixel';
	const cols = kitty ? Math.min(width, KITTY_MAX_CELLS) : width;
	const rows = kitty ? Math.min(height, KITTY_MAX_CELLS) : height;
	const scale = pixelsPerCell(backend, caps.cell);

	const frame = useMemo(() => {
		if (cols === 0 || rows === 0) {
			return {lines: [] as string[], transmit: '', ms: 0};
		}
		const started = performance.now();
		const raster = new Raster(cols * scale.sx, rows * scale.sy, background);
		draw(raster, scale);
		if (kitty) {
			const transmit = kittyTransmit(raster, cols, rows, imageId);
			return {lines: kittyPlaceholders(cols, rows, imageId), transmit, ms: performance.now() - started};
		}
		if (sixel) {
			// The box stays blank; the graphics layer draws the pixels over it.
			const data = sixelFor(raster, cols, rows, caps.cell!);
			return {lines: [] as string[], transmit: '', raster, sixel: data, ms: performance.now() - started};
		}
		const lines = backend === 'braille' ? encodeBraille(raster, cols, rows) : encodeHalf(raster, cols, rows);
		return {lines, transmit: '', ms: performance.now() - started};
	}, [cols, rows, backend, version, scale.sx, scale.sy]);

	useEffect(() => {
		if (frame.transmit) {
			write(frame.transmit);
		}
		if (layer) {
			layer.show(key, frame.raster && ref.current
				? {node: ref.current, bitmap: frame.raster, cols, rows, cell: caps.cell!, sixel: frame.sixel ?? ''}
				: undefined);
		}
		onFrame?.(frame.ms, frame.transmit.length + (frame.sixel?.length ?? 0) + frame.lines.reduce((sum, line) => sum + line.length, 0));
	}, [frame]);

	useEffect(() => () => {
		layer?.show(key, undefined);
		write(`\u001B_Ga=d,d=I,i=${imageId},q=2\u001B\\`);
	}, [imageId]);

	useMouse(event => {
		if (!onPointer || !ref.current || event.kind === 'move') {
			return;
		}
		const origin = absolutePosition(ref.current);
		const x = event.x - origin.x + event.fx;
		const y = event.y - origin.y + event.fy;
		if (x < 0 || y < 0 || x > cols || y > rows) {
			return;
		}
		onPointer({kind: event.kind, button: event.button, ...(event.wheel ? {wheel: event.wheel} : {}), x, y});
	});

	return (
		<Box ref={ref} flexGrow={1} flexDirection="column" overflow="hidden">
			{frame.lines.map((line, index) => (
				<Text key={index} wrap="truncate">{line}</Text>
			))}
		</Box>
	);
}

import {basename} from 'node:path';
import {useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useBoxMetrics, type DOMElement} from 'ink';
import {useKit} from '../context.js';
import {sixelFor, useGraphics} from '../graphics.js';
import type {Caps} from '../probe.js';
import {theme} from '../theme.js';
import {blankBitmap, drawBitmap, encodeHalfBitmap, isBitmap, loadImage, type Bitmap, type Fit} from './bitmap.js';
import {KITTY_MAX_CELLS, kittyPlaceholders, kittyTransmit, nextKittyId, pixelsPerCell} from './encode.js';

export type ImageProps = {
	/** A PNG or JPEG file, or decoded pixels. */
	src: string | Bitmap;
	/** How the image fills its box; 'contain' (default) shows all of it. */
	fit?: Fit;
	/**
	 * Size in cells. With only one of them the other follows the image's
	 * aspect ratio; with neither, the image grows to fill its parent.
	 */
	width?: number;
	height?: number;
	/** Bilinear when enlarging (default); false for nearest, e.g. pixel art. */
	smooth?: boolean;
};

type Loaded = {bitmap?: Bitmap; error?: string};

function reason(error: unknown): string {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (code === 'ENOENT') return 'file not found';
	if (code === 'EACCES' || code === 'EPERM') return 'permission denied';
	if (code === 'EISDIR') return 'is a directory';
	return (error instanceof Error ? error.message : String(error)).split('\n')[0]!.slice(0, 80);
}

/** The decoded image for `src`, loading a path in the background. */
function useBitmap(src: string | Bitmap): Loaded {
	const [state, setState] = useState<Loaded & {src?: string}>({});
	useEffect(() => {
		if (typeof src !== 'string') return;
		let live = true;
		loadImage(src).then(
			bitmap => live && setState({src, bitmap}),
			(error: unknown) => live && setState({src, error: `${basename(src)}: ${reason(error)}`}),
		);
		return () => {
			live = false;
		};
	}, [src]);
	if (typeof src !== 'string') return isBitmap(src) ? {bitmap: src} : {error: 'invalid bitmap'};
	return state.src === src ? state : {};
}

type Backend = 'kitty' | 'sixel' | 'half';

/** Raster pixels per cell, and a pixel's width over its height on screen. */
function scaleFor(backend: Backend, caps: Caps): {sx: number; sy: number; aspect: number} {
	const {sx, sy} = backend === 'half' ? {sx: 1, sy: 2} : pixelsPerCell(backend, caps.cell);
	// Without a reported size, assume cells twice as tall as wide.
	const cell = caps.cell ?? {w: 1, h: 2};
	return {sx, sy, aspect: (cell.w / sx) / (cell.h / sy)};
}

/**
 * Shows a PNG or JPEG scaled into its box, keeping its aspect ratio. Draws
 * with kitty graphics or sixel where the probe enabled them, else with half
 * blocks (truecolor, or 256 colors). A file that cannot be read or decoded
 * shows a one-line message instead.
 */
export function Image({src, fit = 'contain', width, height, smooth = true}: ImageProps) {
	const ref = useRef<DOMElement>(null);
	const box = useBoxMetrics(ref);
	const {caps, write} = useKit();
	const layer = useGraphics();
	const [imageId] = useState(nextKittyId);
	const [key] = useState(() => ({}));
	const {bitmap, error} = useBitmap(src);
	const backend: Backend = caps.graphics === 'kitty' ? 'kitty' : caps.graphics === 'sixel' && caps.cell && layer ? 'sixel' : 'half';
	const cols = backend === 'kitty' ? Math.min(box.width, KITTY_MAX_CELLS) : box.width;
	const rows = backend === 'kitty' ? Math.min(box.height, KITTY_MAX_CELLS) : box.height;

	const frame = useMemo(() => {
		if (!bitmap || cols === 0 || rows === 0) return {lines: [] as string[], transmit: ''};
		const {sx, sy, aspect} = scaleFor(backend, caps);
		const pixels = blankBitmap(cols * sx, rows * sy);
		drawBitmap(pixels, bitmap, {fit, smooth, aspect});
		if (backend === 'kitty') return {lines: kittyPlaceholders(cols, rows, imageId), transmit: kittyTransmit(pixels, cols, rows, imageId)};
		// The box stays blank; the graphics layer draws the pixels over it.
		if (backend === 'sixel') return {lines: [] as string[], transmit: '', pixels, sixel: sixelFor(pixels, cols, rows, caps.cell!)};
		return {lines: encodeHalfBitmap(pixels, cols, rows, caps.truecolor), transmit: ''};
	}, [bitmap, cols, rows, backend, fit, smooth]);

	useEffect(() => {
		if (frame.transmit) write(frame.transmit);
		layer?.show(key, frame.pixels && ref.current
			? {node: ref.current, bitmap: frame.pixels, cols, rows, cell: caps.cell!, sixel: frame.sixel ?? ''}
			: undefined);
	}, [frame]);

	useEffect(() => () => {
		layer?.show(key, undefined);
		if (caps.graphics === 'kitty') write(`\u001B_Ga=d,d=I,i=${imageId},q=2\u001B\\`);
	}, []);

	// One side given: the other follows the image, in cells of cell.w by cell.h.
	const ratio = bitmap && bitmap.width > 0 ? (bitmap.height / bitmap.width) * ((caps.cell?.w ?? 1) / (caps.cell?.h ?? 2)) : 0;
	if (ratio > 0 && width !== undefined && height === undefined) height = Math.max(1, Math.round(width * ratio));
	else if (ratio > 0 && height !== undefined && width === undefined) width = Math.max(1, Math.round(height / ratio));
	const size = {...(width === undefined ? {} : {width}), ...(height === undefined ? {} : {height})};
	return (
		<Box ref={ref} {...size} flexGrow={width === undefined && height === undefined ? 1 : 0} flexDirection="column" overflow="hidden">
			{error
				? <Text color={theme.danger} wrap="truncate">Cannot show image {error}</Text>
				: frame.lines.map((line, index) => <Text key={index} wrap="truncate">{line}</Text>)}
		</Box>
	);
}

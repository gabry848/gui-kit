import {useRef} from 'react';
import {Box, Text, useAnimation, useBoxMetrics, type DOMElement} from 'ink';
import {theme} from '../theme.js';

const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';

/** A spinning braille dot, with an optional label after it. */
export function Spinner({label}: {label?: string}) {
	// Ink shares one timer between every animation on screen.
	const {frame} = useAnimation({interval: 80});
	return (
		<Box gap={1}>
			<Text color={theme.accent}>{FRAMES[frame % FRAMES.length]}</Text>
			{label ? <Text color={theme.text}>{label}</Text> : null}
		</Box>
	);
}

// A cell split in eighths, so the bar grows smoothly instead of a cell at a time.
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

type BarProps = {
	/** 0 to 1; values outside are clamped. */
	value: number;
	label?: string;
	/** Shows the value as a percentage after the bar. */
	percent?: boolean;
	/** Cells for the bar; by default it takes the width its parent gives it. */
	width?: number;
};

/** A bar for a value from 0 to 1, drawn in eighths of a cell. */
export function ProgressBar({value, label, percent = false, width}: BarProps) {
	const ref = useRef<DOMElement>(null);
	const {width: measured} = useBoxMetrics(ref);
	// In a row sized by its content there is no width to take: start from 20
	// cells, as List starts from 10 rows, or the bar stays one cell wide.
	const cells = width ?? (measured > 1 ? measured : 20);
	const fraction = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
	const eighths = Math.round(fraction * cells * 8);
	const full = Math.floor(eighths / 8);
	const partial = EIGHTHS[eighths % 8]!;
	const bar = '█'.repeat(full) + partial + ' '.repeat(Math.max(0, cells - full - (partial ? 1 : 0)));
	return (
		<Box gap={1}>
			{label ? <Text color={theme.text}>{label}</Text> : null}
			<Box ref={ref} flexGrow={width ? 0 : 1} {...(width ? {width} : {})}>
				<Text color={theme.accent} backgroundColor={theme.border}>{bar}</Text>
			</Box>
			{percent ? <Text color={theme.muted}>{`${Math.round(fraction * 100)}%`.padStart(4)}</Text> : null}
		</Box>
	);
}

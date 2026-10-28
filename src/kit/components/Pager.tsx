import {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {Box, Text, useBoxMetrics, type DOMElement} from 'ink';
import {useKeys, useKit, useMouse} from '../context.js';
import {absolutePosition} from '../layout.js';
import {theme} from '../theme.js';

type Props = {
	/** The text, or its lines. */
	text: string | readonly string[];
	active?: boolean;
	/** Rows, the position line included. By default the pager fills the space its parent gives it. */
	height?: number;
	/** Start in follow mode: stay at the end as lines are added. */
	follow?: boolean;
	/** Keep color escapes instead of removing them; lines with colors get no search highlight. */
	ansi?: boolean;
};

// OSC (titles, links), CSI (colors, cursor moves), the other two-byte
// escapes, then any control character left. Tabs are expanded before this.
const ESCAPE = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)?|\u001B\[[0-?]*[ -/]*[@-~]|\u009B[0-?]*[ -/]*[@-~]|\u001B[@-Z\\-_]?|[\u0000-\u001F\u007F]/g;
const COLOR = /^\u001B\[[\d;]*m$/;
const SPECIAL = /[\u0000-\u001F\u007F\u009B]/;

/** One line as the pager shows it: escapes removed, tabs expanded, only the text after the last carriage return. */
export function cleanLine(line: string, keepColors = false): string {
	if (!SPECIAL.test(line)) return line;
	let text = line.endsWith('\r') ? line.slice(0, -1) : line;
	// Progress output redraws the line after a carriage return: keep the last drawing.
	text = text.slice(text.lastIndexOf('\r') + 1);
	if (text.includes('\t')) {
		let expanded = '';
		for (const char of text) expanded += char === '\t' ? ' '.repeat(8 - (expanded.length % 8)) : char;
		text = expanded;
	}
	return text.replace(ESCAPE, escape => (keepColors && COLOR.test(escape) ? escape : ''));
}

function toLines(text: string | readonly string[], keepColors: boolean): string[] {
	if (typeof text !== 'string') return text.map(line => cleanLine(line, keepColors));
	const lines = text.split('\n');
	if (lines.length > 1 && lines.at(-1) === '') lines.pop();
	return lines.map(line => cleanLine(line, keepColors));
}

/** A pattern that matches the text of a search literally. */
function literal(query: string, flags: string): RegExp {
	return new RegExp(query.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&'), flags);
}

/** Index of the first item of a sorted list that is greater than `value`. */
function after(sorted: number[], value: number): number {
	let low = 0;
	let high = sorted.length;
	while (low < high) {
		const middle = (low + high) >> 1;
		if (sorted[middle]! <= value) low = middle + 1;
		else high = middle;
	}
	return low;
}

/**
 * A viewer for long text, like less: only the visible lines are drawn, so it
 * stays fast with 100k lines. `/` searches as you type and highlights the
 * matches, n/N jump between them, F follows the end of a growing text.
 */
export function Pager({text, active = true, height: fixedHeight, follow = false, ansi = false}: Props) {
	const ref = useRef<DOMElement>(null);
	const {height: measured} = useBoxMetrics(ref);
	const {keymap} = useKit();
	// The length too, in case the caller appends to the same array.
	const lines = useMemo(() => toLines(text, ansi), [text, typeof text === 'string' ? 0 : text.length, ansi]);
	const [top, setTop] = useState(0);
	const [following, setFollowing] = useState(follow);
	const [query, setQuery] = useState('');
	const [match, setMatch] = useState(-1);
	const origin = useRef(0);

	const height = fixedHeight ?? (measured > 1 ? measured : Math.min(Math.max(lines.length, 1), 10) + 1);
	const rows = Math.max(1, height - 1);
	const maxTop = Math.max(0, lines.length - rows);
	const view = following ? maxTop : Math.min(top, maxTop);

	const pattern = useMemo(() => (query ? literal(query, 'gi') : undefined), [query]);
	const matches = useMemo(() => {
		const found: number[] = [];
		for (let index = 0; pattern && index < lines.length; index++) {
			if (lines[index]!.search(pattern) !== -1) found.push(index);
		}
		return found;
	}, [lines, pattern]);

	// Moving away from the end leaves follow mode; F turns it back on.
	const scrollTo = (line: number) => {
		const next = Math.min(maxTop, Math.max(0, line));
		setTop(next);
		if (next < maxTop) setFollowing(false);
	};
	const reveal = (line: number) => {
		setMatch(line);
		if (line < view || line >= view + rows) scrollTo(line);
	};
	const jump = (forward: boolean) => {
		if (!query) {
			keymap.flash('No previous search');
			return;
		}
		if (matches.length === 0) {
			keymap.flash(`Pattern not found: ${query}`);
			return;
		}
		// From the current match while it is on screen, otherwise from the screen.
		const onScreen = match >= view && match < view + rows;
		if (forward) {
			const next = matches[after(matches, onScreen ? match : view - 1)];
			if (next === undefined) keymap.flash('Search hit BOTTOM, continuing at TOP');
			reveal(next ?? matches[0]!);
		} else {
			const previous = matches[after(matches, (onScreen ? match : view) - 1) - 1];
			if (previous === undefined) keymap.flash('Search hit TOP, continuing at BOTTOM');
			reveal(previous ?? matches.at(-1)!);
		}
	};

	// Searches as you type from where the search started; Esc goes back there.
	const search = useRef<(value: string, live: boolean) => void>(undefined);
	search.current = (value, live) => {
		setQuery(value);
		if (!value) {
			setMatch(-1);
			if (live) scrollTo(origin.current);
			return;
		}
		const pattern = literal(value, 'i');
		let found = -1;
		for (let index = origin.current; index < lines.length && found === -1; index++) {
			if (pattern.test(lines[index]!)) found = index;
		}
		for (let index = 0; index < origin.current && found === -1; index++) {
			if (pattern.test(lines[index]!)) found = index;
		}
		if (found === -1) {
			setMatch(-1);
			scrollTo(origin.current);
			if (!live) keymap.flash(`Pattern not found: ${value}`);
		} else {
			setMatch(found);
			if (found < origin.current || found >= origin.current + rows) scrollTo(found);
			else scrollTo(origin.current);
		}
	};
	useEffect(() => {
		if (!active) {
			return;
		}
		return keymap.onSearch((value, live) => search.current?.(value, live));
	}, [keymap, active]);

	const half = Math.ceil(rows / 2);
	useKeys(
		[
			{keys: 'j', desc: 'Scroll down', group: 'Pager', run: count => scrollTo(view + count)},
			{keys: 'k', desc: 'Scroll up', group: 'Pager', run: count => scrollTo(view - count)},
			{keys: '<Down>', desc: 'Scroll down', group: 'hidden', run: count => scrollTo(view + count)},
			{keys: '<Up>', desc: 'Scroll up', group: 'hidden', run: count => scrollTo(view - count)},
			{keys: '<C-d>', desc: 'Half page down', group: 'Pager', run: () => scrollTo(view + half)},
			{keys: '<C-u>', desc: 'Half page up', group: 'Pager', run: () => scrollTo(view - half)},
			{keys: '<C-f>', desc: 'Page down', group: 'Pager', run: count => scrollTo(view + count * rows)},
			{keys: '<C-b>', desc: 'Page up', group: 'Pager', run: count => scrollTo(view - count * rows)},
			{keys: '<PageDown>', desc: 'Page down', group: 'hidden', run: count => scrollTo(view + count * rows)},
			{keys: '<PageUp>', desc: 'Page up', group: 'hidden', run: count => scrollTo(view - count * rows)},
			{keys: 'gg', desc: 'Go to the top', group: 'Pager', run: () => scrollTo(0)},
			{keys: 'G', desc: 'Go to the end', group: 'Pager', run: () => scrollTo(maxTop)},
			{keys: '/', desc: 'Search', group: 'Pager', run: () => {
				origin.current = view;
				keymap.openCmdline('/');
			}},
			{keys: 'n', desc: 'Next match', group: 'Pager', run: () => jump(true)},
			{keys: 'N', desc: 'Previous match', group: 'Pager', run: () => jump(false)},
			{keys: 'F', desc: 'Follow the end on or off', group: 'Pager', run: () => {
				setTop(view);
				setFollowing(!following);
			}},
		],
		{active},
	);

	useMouse(event => {
		const node = ref.current;
		if (!node || event.kind !== 'wheel') {
			return;
		}
		const corner = absolutePosition(node);
		if (event.y >= corner.y && event.y < corner.y + height && event.x >= corner.x && event.x < corner.x + (node.yogaNode?.getComputedWidth() ?? 0)) {
			scrollTo(view + (event.wheel === 'down' ? 3 : -3));
		}
	}, active);

	const shown = matches.length > 0 ? after(matches, match - 1) : 0;
	const position = lines.length === 0 ? 'empty' : `${view + 1}-${Math.min(view + rows, lines.length)}/${lines.length}`;
	return (
		<Box ref={ref} flexDirection="column" flexGrow={1} overflow="hidden" {...(fixedHeight ? {height: fixedHeight, flexGrow: 0} : {})}>
			<Box flexDirection="column" height={rows} flexShrink={0}>
				{lines.slice(view, view + rows).map((line, index) => (
					<Box key={index} height={1} overflow="hidden">
						<Text color={theme.text} wrap="truncate-end">{highlight(line, pattern, view + index === match)}</Text>
					</Box>
				))}
			</Box>
			<Box height={1} gap={2} flexShrink={0}>
				<Text color={theme.muted}>{position}</Text>
				{following ? <Text color={theme.accent} bold>FOLLOW</Text> : null}
				{query ? (
					<Text color={theme.muted}>{`/${query}  ${matches.length === 0 ? 'no match' : `${matches[shown] === match ? shown + 1 : '-'}/${matches.length}`}`}</Text>
				) : null}
			</Box>
		</Box>
	);
}

function highlight(line: string, pattern: RegExp | undefined, current: boolean): ReactNode {
	if (!pattern || line.includes('\u001B')) {
		return line;
	}
	const parts: ReactNode[] = [];
	let last = 0;
	for (const found of line.matchAll(pattern)) {
		parts.push(
			line.slice(last, found.index),
			<Text key={found.index} backgroundColor={current ? theme.accent : theme.warning} color={theme.accentText}>{found[0]}</Text>,
		);
		last = found.index + found[0].length;
	}
	if (parts.length === 0) {
		return line;
	}
	parts.push(line.slice(last));
	return parts;
}

import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Box, Text, type DOMElement} from 'ink';
import {useKeys, useKit, useMouse} from '../context.js';
import {absolutePosition} from '../layout.js';
import {theme} from '../theme.js';
import {fingerprint, useCursorReport} from './cursor.js';
import {useAutoHeight} from './height.js';

type Props<T> = {
	items: T[];
	render: (item: T, selected: boolean) => ReactNode;
	/** Text the `/` search matches against. */
	text: (item: T) => string;
	onOpen?: (item: T) => void;
	/**
	 * The highlighted item, each time it changes: the cursor moves, or a
	 * filter, a sort or new `items` put another item under it. First called
	 * on mount. undefined when nothing is highlighted: an empty list, a filter
	 * that matches nothing, or the list unmounting. An item counts as the
	 * same while its row, its `text` and its own string, number and boolean
	 * fields stay the same, or with `id`, while its row and its id do.
	 */
	onCursor?: (item: T | undefined) => void;
	/**
	 * What makes an item itself, e.g. `p => p.pid`, for onCursor. Needed when
	 * two items can differ only in nested objects; it also stops reports for
	 * changes to fields that do not matter (a timestamp).
	 */
	id?: (item: T) => string | number;
	active?: boolean;
	/** Rows to show. By default the list fills the space its parent gives it. */
	height?: number;
};

/** A scrolling list driven by Vim keys, the mouse wheel and clicks. */
export function List<T>({items, render, text, onOpen, onCursor, id, active = true, height: fixedHeight}: Props<T>) {
	const ref = useRef<DOMElement>(null);
	const {keymap} = useKit();
	const [query, setQuery] = useState('');
	const [cursor, setCursor] = useState(0);
	const [offset, setOffset] = useState(0);

	const visible = query ? items.filter(item => text(item).toLowerCase().includes(query.toLowerCase())) : items;
	// The space the parent gives, or up to 10 rows in a parent sized by its content.
	const height = useAutoHeight(ref, Math.min(Math.max(visible.length, 1), 10), fixedHeight);
	const rows = Math.max(1, height);
	const last = Math.max(0, visible.length - 1);

	const moveTo = (index: number) => {
		const next = Math.min(last, Math.max(0, index));
		setCursor(next);
		setOffset(current => (next < current ? next : next >= current + rows ? next - rows + 1 : current));
	};

	useEffect(() => moveTo(cursor), [rows, visible.length]);

	// The row the cursor lands on once moveTo has clamped it. Compared by row
	// and content (or id), not identity: items rebuilt on every render would
	// otherwise report on every render, and a parent that stores them would loop.
	const highlighted = Math.min(cursor, last);
	const item = visible[highlighted];
	const signature = item === undefined ? undefined
		: `${highlighted}\u0001${id ? String(id(item)) : `${text(item)}\u0001${fingerprint(item)}`}`;
	useCursorReport(signature, item, onCursor);

	useEffect(() => {
		if (!active) {
			return;
		}
		return keymap.onSearch((value, live) => {
			setQuery(value);
			setCursor(0);
			setOffset(0);
			if (!live) {
				keymap.flash(value ? `Filter: ${value}` : '');
			}
		});
	}, [keymap, active]);

	const open = () => {
		const item = visible[cursor];
		if (item !== undefined) {
			onOpen?.(item);
		}
	};

	useKeys(
		[
			{keys: 'j', desc: 'Down', group: 'List', run: count => moveTo(cursor + count)},
			{keys: 'k', desc: 'Up', group: 'List', run: count => moveTo(cursor - count)},
			{keys: '<Down>', desc: 'Down', group: 'hidden', run: count => moveTo(cursor + count)},
			{keys: '<Up>', desc: 'Up', group: 'hidden', run: count => moveTo(cursor - count)},
			{keys: 'gg', desc: 'First', group: 'List', run: () => moveTo(0)},
			{keys: 'G', desc: 'Last', group: 'List', run: () => moveTo(last)},
			{keys: '<C-d>', desc: 'Half page down', group: 'List', run: () => moveTo(cursor + Math.ceil(rows / 2))},
			{keys: '<C-u>', desc: 'Half page up', group: 'List', run: () => moveTo(cursor - Math.ceil(rows / 2))},
			{keys: '/', desc: 'Search', group: 'List', run: () => keymap.openCmdline('/')},
			{keys: '<CR>', desc: 'Open', group: 'List', run: open},
		],
		{active},
	);

	useMouse(event => {
		const node = ref.current;
		if (!node) {
			return;
		}
		const origin = absolutePosition(node);
		const row = event.y - origin.y;
		// Outside the list on either side, e.g. a click in the next pane of a Split.
		if (row < 0 || row >= rows || event.x < origin.x || event.x >= origin.x + (node.yogaNode?.getComputedWidth() ?? Infinity)) {
			return;
		}
		if (event.kind === 'wheel') {
			moveTo(cursor + (event.wheel === 'down' ? 3 : -3));
		} else if (event.kind === 'down' && event.button === 'left') {
			const index = offset + row;
			if (index === cursor) {
				open();
			} else {
				moveTo(index);
			}
		}
	}, active);

	return (
		<Box ref={ref} flexDirection="column" flexGrow={1} overflow="hidden" {...(fixedHeight ? {height: fixedHeight, flexGrow: 0} : {})}>
			{visible.slice(offset, offset + rows).map((item, index) => {
				const selected = offset + index === cursor;
				return (
					<Box key={offset + index} height={1} flexShrink={0} {...(selected ? {backgroundColor: theme.selection} : {})}>
						<Text color={selected ? theme.accent : theme.muted}>{selected ? '▌' : ' '}</Text>
						{render(item, selected)}
					</Box>
				);
			})}
			{visible.length === 0 ? <Text color={theme.muted}> No results</Text> : null}
		</Box>
	);
}

import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Box, Text, useBoxMetrics, type DOMElement} from 'ink';
import {useKeys, useKit, useMouse} from '../context.js';
import {absolutePosition} from '../layout.js';
import {theme} from '../theme.js';

type Props<T> = {
	items: T[];
	render: (item: T, selected: boolean) => ReactNode;
	/** Text the `/` search matches against. */
	text: (item: T) => string;
	onOpen?: (item: T) => void;
	active?: boolean;
	/** Rows to show. By default the list fills the space its parent gives it. */
	height?: number;
};

/** A scrolling list driven by Vim keys, the mouse wheel and clicks. */
export function List<T>({items, render, text, onOpen, active = true, height: fixedHeight}: Props<T>) {
	const ref = useRef<DOMElement>(null);
	const {height: measured} = useBoxMetrics(ref);
	const {keymap} = useKit();
	const [query, setQuery] = useState('');
	const [cursor, setCursor] = useState(0);
	const [offset, setOffset] = useState(0);

	const visible = query ? items.filter(item => text(item).toLowerCase().includes(query.toLowerCase())) : items;
	// A parent that takes its height from its content measures exactly what was
	// drawn, so start from up to 10 rows instead of 1, or the list stays one row tall.
	const height = fixedHeight ?? (measured > 1 ? measured : Math.min(Math.max(visible.length, 1), 10));
	const rows = Math.max(1, height);
	const last = Math.max(0, visible.length - 1);

	const moveTo = (index: number) => {
		const next = Math.min(last, Math.max(0, index));
		setCursor(next);
		setOffset(current => (next < current ? next : next >= current + rows ? next - rows + 1 : current));
	};

	useEffect(() => moveTo(cursor), [rows, visible.length]);

	useEffect(() => {
		if (!active) {
			return;
		}
		keymap.onSearch((value, live) => {
			setQuery(value);
			setCursor(0);
			setOffset(0);
			if (!live) {
				keymap.flash(value ? `Filtro: ${value}` : '');
			}
		});
		return () => keymap.onSearch(undefined);
	}, [keymap, active]);

	const open = () => {
		const item = visible[cursor];
		if (item !== undefined) {
			onOpen?.(item);
		}
	};

	useKeys(
		[
			{keys: 'j', desc: 'Giù', group: 'Lista', run: count => moveTo(cursor + count)},
			{keys: 'k', desc: 'Su', group: 'Lista', run: count => moveTo(cursor - count)},
			{keys: '<Down>', desc: 'Giù', group: 'hidden', run: count => moveTo(cursor + count)},
			{keys: '<Up>', desc: 'Su', group: 'hidden', run: count => moveTo(cursor - count)},
			{keys: 'gg', desc: 'Primo', group: 'Lista', run: () => moveTo(0)},
			{keys: 'G', desc: 'Ultimo', group: 'Lista', run: () => moveTo(last)},
			{keys: '<C-d>', desc: 'Mezza pagina giù', group: 'Lista', run: () => moveTo(cursor + Math.ceil(rows / 2))},
			{keys: '<C-u>', desc: 'Mezza pagina su', group: 'Lista', run: () => moveTo(cursor - Math.ceil(rows / 2))},
			{keys: '/', desc: 'Cerca', group: 'Lista', run: () => keymap.openCmdline('/')},
			{keys: '<CR>', desc: 'Apri', group: 'Lista', run: open},
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
		if (row < 0 || row >= rows || event.x < origin.x) {
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
					<Box key={offset + index} height={1} {...(selected ? {backgroundColor: theme.selection} : {})}>
						<Text color={selected ? theme.accent : theme.muted}>{selected ? '▌' : ' '}</Text>
						{render(item, selected)}
					</Box>
				);
			})}
			{visible.length === 0 ? <Text color={theme.muted}> Nessun risultato</Text> : null}
		</Box>
	);
}

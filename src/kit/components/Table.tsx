import {useState} from 'react';
import {Box, Text} from 'ink';
import {useKeys} from '../context.js';
import {theme} from '../theme.js';
import {List} from './List.js';

/** One column per key of the row; `format` gets that key's own value type. */
export type Column<T> = {
	[K in keyof T & string]: {
		key: K;
		title: string;
		width?: number;
		align?: 'left' | 'right';
		format?: (value: T[K], row: T) => string;
	};
}[keyof T & string];

type Props<T> = {
	columns: Column<T>[];
	rows: T[];
	onOpen?: (row: T) => void;
	/**
	 * The highlighted row each time it changes, sorting included, as List's
	 * onCursor; undefined when none is. A row counts as the same while its
	 * position and its own string, number and boolean fields stay the same
	 * (columns or not), or with `id`, while its position and id do.
	 */
	onCursor?: (row: T | undefined) => void;
	/** What makes a row itself, e.g. `p => p.pid`, for onCursor; as List's `id`. */
	id?: (row: T) => string | number;
	active?: boolean;
};

/** The text cut to `width`; padded to it, unless it is the last column and left-aligned. */
function fit(text: string, width: number, align: 'left' | 'right', last = false): string {
	const cut = [...text].length > width ? [...text].slice(0, Math.max(0, width - 1)).join('') + '…' : text;
	return align === 'right' ? cut.padStart(width) : last ? cut : cut.padEnd(width);
}

/** Rows and columns with a header; `s` sorts by the next column, `S` flips the order. */
export function Table<T extends object>({columns, rows, onOpen, onCursor, id, active = true}: Props<T>) {
	const [sort, setSort] = useState<{column: number; descending: boolean} | undefined>();
	const cell = (row: T, column: Column<T>) => {
		const format = column.format as ((value: unknown, row: T) => string) | undefined;
		const value: unknown = row[column.key];
		return format ? format(value, row) : String(value ?? '');
	};
	// Room for the title plus its sort arrow, or the widest of the first 200 cells.
	const widths = columns.map(column => column.width ?? Math.max(column.title.length + 2, ...rows.slice(0, 200).map(row => cell(row, column).length)) + 1);

	const sorted = sort === undefined ? rows : [...rows].sort((a, b) => {
		const column = columns[sort.column]!;
		const x: unknown = a[column.key];
		const y: unknown = b[column.key];
		const order = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
		return sort.descending ? -order : order;
	});

	useKeys(
		[
			{keys: 's', desc: 'Sort by the next column', group: 'Table', run: () => setSort(current => ({column: current === undefined ? 0 : (current.column + 1) % columns.length, descending: false}))},
			{keys: 'S', desc: 'Reverse the order', group: 'Table', run: () => setSort(current => ({column: current?.column ?? 0, descending: !current?.descending}))},
		],
		{active},
	);

	// In a narrow pane only the last column gives up room, cut with an
	// ellipsis; the others keep their width, so values and the header stay aligned.
	const lastColumn = columns.length - 1;
	return (
		<Box flexDirection="column" flexGrow={1}>
			<Box height={1} flexShrink={0}>
				<Box flexShrink={0}><Text> </Text></Box>
				{columns.map((column, index) => (
					<Box key={column.key} flexShrink={index === lastColumn ? 1 : 0}>
						<Text color={theme.muted} bold wrap="truncate-end">
							{fit(column.title + (sort?.column === index ? (sort.descending ? ' ↓' : ' ↑') : ''), widths[index]!, column.align ?? 'left', index === lastColumn) + (index === lastColumn ? '' : ' ')}
						</Text>
					</Box>
				))}
			</Box>
			<List
				items={sorted}
				text={row => columns.map(column => cell(row, column)).join(' ')}
				active={active}
				{...(onOpen ? {onOpen} : {})}
				{...(onCursor ? {onCursor} : {})}
				{...(id ? {id} : {})}
				render={(row, selected) => (
					<Box>
						{columns.map((column, index) => (
							<Box key={column.key} flexShrink={index === lastColumn ? 1 : 0}>
								<Text color={theme.text} bold={selected && index === 0} wrap="truncate-end">
									{fit(cell(row, column), widths[index]!, column.align ?? 'left', index === lastColumn) + (index === lastColumn ? '' : ' ')}
								</Text>
							</Box>
						))}
					</Box>
				)}
			/>
		</Box>
	);
}

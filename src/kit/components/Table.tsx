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
	active?: boolean;
};

function fit(text: string, width: number, align: 'left' | 'right'): string {
	const cut = [...text].length > width ? [...text].slice(0, Math.max(0, width - 1)).join('') + '…' : text;
	return align === 'right' ? cut.padStart(width) : cut.padEnd(width);
}

/** Rows and columns with a header; `s` sorts by the next column, `S` flips the order. */
export function Table<T extends object>({columns, rows, onOpen, active = true}: Props<T>) {
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
			{keys: 's', desc: 'Ordina per la colonna successiva', group: 'Tabella', run: () => setSort(current => ({column: current === undefined ? 0 : (current.column + 1) % columns.length, descending: false}))},
			{keys: 'S', desc: 'Inverti l\'ordine', group: 'Tabella', run: () => setSort(current => ({column: current?.column ?? 0, descending: !current?.descending}))},
		],
		{active},
	);

	return (
		<Box flexDirection="column" flexGrow={1}>
			<Box height={1}>
				<Text> </Text>
				{columns.map((column, index) => (
					<Text key={column.key} color={theme.muted} bold>
						{fit(column.title + (sort?.column === index ? (sort.descending ? ' ↓' : ' ↑') : ''), widths[index]!, column.align ?? 'left') + ' '}
					</Text>
				))}
			</Box>
			<List
				items={sorted}
				text={row => columns.map(column => cell(row, column)).join(' ')}
				active={active}
				{...(onOpen ? {onOpen} : {})}
				render={(row, selected) => (
					<Box>
						{columns.map((column, index) => (
							<Text key={column.key} color={theme.text} bold={selected && index === 0}>
								{fit(cell(row, column), widths[index]!, column.align ?? 'left') + ' '}
							</Text>
						))}
					</Box>
				)}
			/>
		</Box>
	);
}

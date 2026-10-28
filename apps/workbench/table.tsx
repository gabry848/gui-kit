// A Table that also reports the row under the cursor. The kit's Table only
// calls onOpen on Enter, but the Git tab shows the diff of the highlighted
// file and the Ports tab stops the highlighted process, so this one wraps the
// kit's List the way Table does and adds onCursor.

import {Box, List, Text, theme, useEffect, useRef, type Column} from 'gui-kit';

type Props<T> = {
	columns: Column<T>[];
	rows: T[];
	/** The highlighted row; undefined when there is none, e.g. a `/` filter that matches nothing. */
	onCursor?: (row: T | undefined) => void;
	onOpen?: (row: T) => void;
	active?: boolean;
};

function fit(text: string, width: number, align: 'left' | 'right'): string {
	const chars = [...text];
	const cut = chars.length > width ? chars.slice(0, Math.max(0, width - 1)).join('') + '…' : text;
	return align === 'right' ? cut.padStart(width) : cut.padEnd(width);
}

/**
 * Rendered only inside the highlighted row. Effects of the row that loses
 * the highlight clean up before those of the row that gets it, so the last
 * call is always the current row.
 */
function Cursor<T>({row, report}: {row: T; report: (row: T | undefined) => void}) {
	useEffect(() => {
		report(row);
		return () => report(undefined);
	}, [row]);
	return null;
}

export function CursorTable<T extends object>({columns, rows, onCursor, onOpen, active = true}: Props<T>) {
	const latest = useRef(onCursor);
	latest.current = onCursor;
	const report = (row: T | undefined) => latest.current?.(row);

	const cell = (row: T, column: Column<T>) => {
		const format = column.format as ((value: unknown, row: T) => string) | undefined;
		const value: unknown = row[column.key];
		return format ? format(value, row) : String(value ?? '');
	};
	const widths = columns.map(column => column.width ?? Math.max(column.title.length, ...rows.slice(0, 200).map(row => cell(row, column).length)) + 1);
	const last = columns.length - 1;

	return (
		<Box flexDirection="column" flexGrow={1}>
			<Box height={1} flexShrink={0}>
				<Text> </Text>
				{columns.map((column, index) => (
					<Text key={column.key} color={theme.muted} bold wrap="truncate-end">
						{index === last ? column.title : fit(column.title, widths[index]!, column.align ?? 'left') + ' '}
					</Text>
				))}
			</Box>
			<List
				items={rows}
				text={row => columns.map(column => cell(row, column)).join(' ')}
				active={active}
				{...(onOpen ? {onOpen} : {})}
				render={(row, selected) => (
					<Box>
						{columns.map((column, index) => (
							// The last column takes what is left and is cut at the pane's edge.
							<Box key={column.key} flexShrink={index === last ? 1 : 0}>
								<Text color={theme.text} bold={selected && index === 0} wrap="truncate-end">
									{index === last ? cell(row, column) : fit(cell(row, column), widths[index]!, column.align ?? 'left') + ' '}
								</Text>
							</Box>
						))}
						{selected ? <Cursor row={row} report={report} /> : null}
					</Box>
				)}
			/>
		</Box>
	);
}

import {Box, Text} from 'ink';
import {theme} from '../theme.js';
import {fingerprint} from './cursor.js';
import {List} from './List.js';

export type Option<T> = {label: string; value: T; hint?: string};

type Props<T> = {
	options: Option<T>[];
	onSelect: (value: T) => void;
	/**
	 * The value of the highlighted option each time it changes, as List's
	 * onCursor; undefined when none is. An option counts as the same while
	 * its row, label, hint and the value's own string, number and boolean
	 * fields stay the same, or with `id`, while its row and id do.
	 */
	onCursor?: (value: T | undefined) => void;
	/** What makes a value itself, e.g. `v => v.pid`, for onCursor; as List's `id`. */
	id?: (value: T) => string | number;
	active?: boolean;
};

/** Pick one option: j/k, / to filter, Enter or a click to choose. */
export function Select<T>({options, onSelect, onCursor, id, active = true}: Props<T>) {
	return (
		<List
			items={options}
			text={option => `${option.label} ${option.hint ?? ''}`}
			onOpen={option => onSelect(option.value)}
			id={option => (id ? id(option.value) : `${option.label}\u0001${option.hint ?? ''}\u0001${fingerprint(option.value)}`)}
			{...(onCursor ? {onCursor: (option: Option<T> | undefined) => onCursor(option?.value)} : {})}
			active={active}
			render={(option, selected) => (
				<Box gap={2}>
					<Text color={theme.text} bold={selected}>{option.label}</Text>
					{option.hint ? <Text color={theme.muted}>{option.hint}</Text> : null}
				</Box>
			)}
		/>
	);
}

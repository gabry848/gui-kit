import {Box, Text} from 'ink';
import {theme} from '../theme.js';
import {List} from './List.js';

export type Option<T> = {label: string; value: T; hint?: string};

type Props<T> = {
	options: Option<T>[];
	onSelect: (value: T) => void;
	active?: boolean;
};

/** Pick one option: j/k, / to filter, Enter or a click to choose. */
export function Select<T>({options, onSelect, active = true}: Props<T>) {
	return (
		<List
			items={options}
			text={option => `${option.label} ${option.hint ?? ''}`}
			onOpen={option => onSelect(option.value)}
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

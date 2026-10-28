import {useRef} from 'react';
import {Box, Text} from 'ink';
import {useKeymapState, useKeys, useKit} from '../context.js';
import {theme} from '../theme.js';

type Props = {
	value: string;
	onChange: (value: string) => void;
	onSubmit?: (value: string) => void;
	placeholder?: string;
	/** Whether this input has the focus; only then do its keys work. */
	active?: boolean;
};

/** One line of text, edited Vim style: `i` or Enter to type, Esc to stop. */
export function TextInput({value, onChange, onSubmit, placeholder = '', active = true}: Props) {
	const {keymap} = useKit();
	const {mode} = useKeymapState();
	const editing = active && mode === 'insert';
	// Several keys can arrive before the next render; edit the newest value, not the rendered one.
	const latest = useRef(value);
	latest.current = value;
	const change = (next: string) => {
		latest.current = next;
		onChange(next);
	};

	useKeys(
		[
			{keys: 'i', desc: 'Type in the field', group: 'Field', run: () => keymap.setMode('insert')},
			{keys: 'a', desc: 'Type in the field', group: 'hidden', run: () => keymap.setMode('insert')},
			{keys: '<CR>', desc: 'Type in the field', group: 'hidden', run: () => keymap.setMode('insert')},
			{keys: 'cc', desc: 'Clear and type', group: 'Field', run: () => {
				change('');
				keymap.setMode('insert');
			}},
			{keys: '<BS>', mode: 'insert', desc: 'Delete a character', group: 'hidden', run: () => change([...latest.current].slice(0, -1).join(''))},
			{keys: '<C-u>', mode: 'insert', desc: 'Clear the line', group: 'hidden', run: () => change('')},
			{keys: '<C-w>', mode: 'insert', desc: 'Delete a word', group: 'hidden', run: () => change(latest.current.replace(/\S*\s*$/, ''))},
			{keys: '<CR>', mode: 'insert', desc: 'Confirm the field', group: 'hidden', run: () => {
				keymap.setMode('normal');
				onSubmit?.(latest.current);
			}},
		],
		{active, onText: text => change(latest.current + text)},
	);

	if (editing) {
		return (
			<Box>
				<Text color={theme.text}>{value}</Text>
				<Text inverse> </Text>
			</Box>
		);
	}
	return value ? <Text color={theme.text}>{value}</Text> : <Text color={theme.muted}>{placeholder}</Text>;
}

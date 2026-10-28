import {useRef, useState} from 'react';
import {Box, Text, type DOMElement} from 'ink';
import {useKeymapState, useKeys, useKit, useMouse} from '../context.js';
import {absolutePosition} from '../layout.js';
import {theme} from '../theme.js';
import {TextInput} from './TextInput.js';

export type Field =
	| {name: string; label: string; type: 'text'; placeholder?: string; default?: string}
	| {name: string; label: string; type: 'select'; options: string[]; default?: string}
	| {name: string; label: string; type: 'checkbox'; default?: boolean};

export type FormValues = Record<string, string | boolean>;

type Props = {
	fields: Field[];
	onSubmit: (values: FormValues) => void;
	submitLabel?: string;
	active?: boolean;
};

function initial(fields: Field[]): FormValues {
	const values: FormValues = {};
	for (const field of fields) {
		if (field.type === 'checkbox') values[field.name] = field.default ?? false;
		else if (field.type === 'select') values[field.name] = field.default ?? field.options[0] ?? '';
		else values[field.name] = field.default ?? '';
	}
	return values;
}

/**
 * A vertical form. j/k or Tab move between fields; Enter edits text, cycles
 * a choice or ticks a box; h/l cycle choices; Ctrl-s or the last row submits.
 */
export function Form({fields, onSubmit, submitLabel = 'Submit', active = true}: Props) {
	const [values, setValues] = useState(() => initial(fields));
	const [row, setRow] = useState(0);
	const {mode} = useKeymapState();
	const rows = useRef<(DOMElement | null)[]>([]);
	const last = fields.length;
	const field = fields[row];
	const set = (name: string, value: string | boolean) => setValues(current => ({...current, [name]: value}));
	const move = (delta: number) => setRow(current => Math.min(last, Math.max(0, current + delta)));

	const cycle = (delta: number) => {
		if (field?.type !== 'select') return;
		const index = field.options.indexOf(String(values[field.name]));
		set(field.name, field.options[(index + delta + field.options.length) % field.options.length]!);
	};
	const activate = () => {
		if (row === last) onSubmit(values);
		else if (field?.type === 'select') cycle(1);
		else if (field?.type === 'checkbox') set(field.name, !values[field.name]);
	};

	const editingText = field?.type === 'text';
	useKeys(
		[
			{keys: 'j', desc: 'Next field', group: 'Form', run: count => move(count)},
			{keys: 'k', desc: 'Previous field', group: 'Form', run: count => move(-count)},
			{keys: '<Tab>', desc: 'Next field', group: 'hidden', run: () => move(1)},
			{keys: '<S-Tab>', desc: 'Previous field', group: 'hidden', run: () => move(-1)},
			{keys: '<Down>', desc: 'Next field', group: 'hidden', run: () => move(1)},
			{keys: '<Up>', desc: 'Previous field', group: 'hidden', run: () => move(-1)},
			{keys: 'h', desc: 'Previous choice', group: 'Form', run: () => cycle(-1)},
			{keys: 'l', desc: 'Next choice', group: 'Form', run: () => cycle(1)},
			{keys: 'x', desc: 'Tick or untick', group: 'Form', run: activate},
			{keys: '<C-s>', desc: 'Submit the form', group: 'Form', run: () => onSubmit(values)},
			// Text fields own Enter; every other row uses it here.
			...(editingText ? [] : [{keys: '<CR>', desc: 'Activate the field', group: 'Form', run: activate}]),
		],
		{active: active && mode !== 'insert'},
	);
	// Ctrl-s also submits while typing in a field.
	const keymap = useKit().keymap;
	useKeys(
		[{keys: '<C-s>', mode: 'insert', desc: 'Submit the form', group: 'hidden', run: () => {
			keymap.setMode('normal');
			onSubmit(values);
		}}],
		{active},
	);

	useMouse(event => {
		if (event.kind !== 'down' || event.button !== 'left') return;
		rows.current.forEach((node, index) => {
			if (node && absolutePosition(node).y === event.y) {
				setRow(index);
				if (index === row) activate();
			}
		});
	}, active);

	const labelWidth = Math.max(...fields.map(item => item.label.length)) + 2;
	return (
		<Box flexDirection="column">
			{fields.map((item, index) => {
				const focused = index === row;
				return (
					<Box key={item.name} ref={node => {
						rows.current[index] = node;
					}} height={1}>
						<Text color={focused ? theme.accent : theme.muted}>{focused ? '› ' : '  '}</Text>
						<Box width={labelWidth}>
							<Text color={focused ? theme.text : theme.muted} bold={focused}>{item.label}</Text>
						</Box>
						{item.type === 'text' ? (
							<TextInput
								value={String(values[item.name])}
								onChange={value => set(item.name, value)}
								onSubmit={() => move(1)}
								placeholder={item.placeholder ?? ''}
								active={active && focused}
							/>
						) : item.type === 'select' ? (
							<Text color={theme.text}>{`‹ ${String(values[item.name])} ›`}<Text color={theme.muted}>{`  ${item.options.indexOf(String(values[item.name])) + 1}/${item.options.length}`}</Text></Text>
						) : (
							<Text color={values[item.name] ? theme.success : theme.muted}>{values[item.name] ? '[x]' : '[ ]'}</Text>
						)}
					</Box>
				);
			})}
			<Box height={1} />
			<Box ref={node => {
				rows.current[last] = node;
			}} height={1}>
				<Text color={row === last ? theme.accent : theme.muted}>{row === last ? '› ' : '  '}</Text>
				<Text {...(row === last ? {backgroundColor: theme.accent, color: theme.accentText} : {color: theme.text})} bold>{` ${submitLabel} `}</Text>
				<Text color={theme.muted}>   Ctrl-s submits from any field</Text>
			</Box>
		</Box>
	);
}

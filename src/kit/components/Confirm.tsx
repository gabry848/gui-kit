import {Box, Text} from 'ink';
import {useContext} from 'react';
import {KeyScope, useKeys, useMouseBarrier} from '../context.js';
import {theme} from '../theme.js';

type Props = {
	question: string;
	onAnswer: (yes: boolean) => void;
	active?: boolean;
};

/** A yes/no question: y or Enter for yes, n or Esc for no. */
export function Confirm({question, onAnswer, active = true}: Props) {
	useKeys(
		[
			{keys: 'y', desc: 'Sì', group: 'Domanda', run: () => onAnswer(true)},
			{keys: '<CR>', desc: 'Sì', group: 'hidden', run: () => onAnswer(true)},
			{keys: 'n', desc: 'No', group: 'Domanda', run: () => onAnswer(false)},
			{keys: '<Esc>', desc: 'No', group: 'hidden', run: () => onAnswer(false)},
		],
		{active, modal: true},
	);
	// Like its keys, clicks stop here while the question is open.
	useMouseBarrier(useContext(KeyScope) + 10, active);
	return (
		<Box gap={2}>
			<Text color={theme.text} bold>{question}</Text>
			<Text color={theme.success}>[y] sì</Text>
			<Text color={theme.danger}>[n] no</Text>
		</Box>
	);
}

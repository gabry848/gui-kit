// Pick one item with `gui ask`; prints the chosen value as JSON.
import {Select, Shell, useFinish} from 'gui-kit';

const OPTIONS = [
	{label: 'Ghostty', value: 'ghostty', hint: 'il terminale di tutti i giorni'},
	{label: 'tmux', value: 'tmux', hint: 'sessioni staccate'},
	{label: 'ssh', value: 'ssh', hint: 'su un altro computer'},
];

export default function App() {
	const finish = useFinish();
	return (
		<Shell title="Dove lo apro?">
			<Select options={OPTIONS} onSelect={finish} />
		</Shell>
	);
}

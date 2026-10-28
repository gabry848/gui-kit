// Pick one item with `gui ask`; prints the chosen value as JSON.
import {Select, Shell, useFinish} from 'gui-kit';

const OPTIONS = [
	{label: 'Ghostty', value: 'ghostty', hint: 'the everyday terminal'},
	{label: 'tmux', value: 'tmux', hint: 'detached sessions'},
	{label: 'ssh', value: 'ssh', hint: 'on another computer'},
];

export default function App() {
	const finish = useFinish();
	return (
		<Shell title="Where should I open it?">
			<Select options={OPTIONS} onSelect={finish} />
		</Shell>
	);
}

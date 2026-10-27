// A one-off form an agent can show with `gui ask`: the answers come back as JSON.
import {Box, Form, Shell, Text, theme, useFinish} from 'gui-kit';

export default function App() {
	const finish = useFinish();
	return (
		<Shell title="Nuovo progetto">
			<Box flexDirection="column" paddingX={2} paddingY={1}>
				<Text color={theme.accent} bold>Come imposto il progetto?</Text>
				<Box height={1} />
				<Form
					fields={[
						{name: 'nome', label: 'Nome', type: 'text', placeholder: 'es. fatture-2026'},
						{name: 'stack', label: 'Stack', type: 'select', options: ['Bun + TypeScript', 'Python + uv', 'Go']},
						{name: 'git', label: 'Repository git', type: 'checkbox', default: true},
					]}
					onSubmit={finish}
				/>
			</Box>
		</Shell>
	);
}

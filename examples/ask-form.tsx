// A one-off form an agent can show with `gui ask`: the answers come back as JSON.
import {Box, Form, Shell, Text, theme, useFinish} from 'gui-kit';

export default function App() {
	const finish = useFinish();
	return (
		<Shell title="New project">
			<Box flexDirection="column" paddingX={2} paddingY={1}>
				<Text color={theme.accent} bold>How should I set up the project?</Text>
				<Box height={1} />
				<Form
					fields={[
						{name: 'name', label: 'Name', type: 'text', placeholder: 'e.g. invoices-2026'},
						{name: 'stack', label: 'Stack', type: 'select', options: ['Bun + TypeScript', 'Python + uv', 'Go']},
						{name: 'git', label: 'Git repository', type: 'checkbox', default: true},
					]}
					onSubmit={finish}
				/>
			</Box>
		</Shell>
	);
}

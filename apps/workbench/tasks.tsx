// Tasks: package.json scripts and Makefile targets, run with Enter. The
// process itself lives in the App (see app.tsx), so it keeps running, and
// still notifies, while another tab is open.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Box, List, Pager, Spinner, Split, Text, theme, useKeys, useMemo, type ProcessHandle} from 'gui-kit';
import {makeTasks, packageTasks, type Task} from './parse.js';

export type Run = {id: number; task: Task};

const MAKEFILES = ['GNUmakefile', 'makefile', 'Makefile'];

/** The project's tasks: package.json scripts first, then Makefile targets. */
export function loadTasks(cwd: string): {tasks: Task[]; problems: string[]} {
	const tasks: Task[] = [];
	const problems: string[] = [];
	const read = (name: string) => {
		try {
			return readFileSync(join(cwd, name), 'utf8');
		} catch (error) {
			problems.push(`${name}: ${(error as NodeJS.ErrnoException).code ?? String(error)}`);
			return undefined;
		}
	};
	if (existsSync(join(cwd, 'package.json'))) {
		const json = read('package.json');
		if (json !== undefined) {
			const locks = {npm: existsSync(join(cwd, 'package-lock.json')), bun: existsSync(join(cwd, 'bun.lock')) || existsSync(join(cwd, 'bun.lockb'))};
			const scripts = packageTasks(json, locks);
			if (scripts.length === 0) problems.push('package.json has no scripts');
			tasks.push(...scripts);
		}
	}
	const makefile = MAKEFILES.find(name => existsSync(join(cwd, name)));
	if (makefile) {
		const text = read(makefile);
		if (text !== undefined) tasks.push(...makeTasks(text));
	}
	return {tasks, problems};
}

/** argv as you would type it. */
export function shellLine(argv: string[]): string {
	return argv.map(arg => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll('\'', '\'\\\'\'')}'`)).join(' ');
}

function Status({job}: {job: ProcessHandle}) {
	if (job.running) return <Spinner label="running" />;
	if (job.error) return <Text color={theme.danger}>{`could not start: ${job.error}`}</Text>;
	if (job.signal) return <Text color={theme.warning}>{`stopped (${job.signal})`}</Text>;
	if (job.exitCode !== null) return <Text color={job.exitCode === 0 ? theme.success : theme.danger}>{`exit ${job.exitCode}`}</Text>;
	return null;
}

type Props = {
	cwd: string;
	job: ProcessHandle;
	run: Run | undefined;
	onRun: (task: Task) => void;
};

export function TasksTab({cwd, job, run, onRun}: Props) {
	const {tasks, problems} = useMemo(() => loadTasks(cwd), [cwd]);
	const nameWidth = Math.min(24, Math.max(4, ...tasks.map(task => task.name.length)));

	useKeys([
		{keys: 'r', desc: 'Run the last task again', group: 'Tasks', run: () => {
			if (run) onRun(run.task);
		}},
		{keys: '<C-k>', desc: 'Stop the running task (SIGTERM)', group: 'Tasks', run: () => job.kill()},
	]);

	const list = (active: boolean) => {
		if (tasks.length === 0) {
			return (
				<Box flexDirection="column">
					<Text color={theme.muted}>No package.json scripts or Makefile targets here.</Text>
					{problems.map(problem => <Text key={problem} color={theme.warning}>{problem}</Text>)}
				</Box>
			);
		}
		return (
			<List
				items={tasks}
				text={task => `${task.name} ${task.kind} ${task.detail}`}
				onOpen={onRun}
				active={active}
				render={(task, selected) => {
					const running = job.running && run?.task.kind === task.kind && run.task.name === task.name;
					return (
						<Box gap={1}>
							<Box width={nameWidth} flexShrink={0}>
								<Text color={theme.text} bold={selected} wrap="truncate-end">{task.name}</Text>
							</Box>
							<Box width={4} flexShrink={0}><Text color={theme.accent}>{task.kind}</Text></Box>
							{running ? <Spinner /> : null}
							<Box flexShrink={1}><Text color={theme.muted} wrap="truncate-end">{task.detail}</Text></Box>
						</Box>
					);
				}}
			/>
		);
	};

	const output = (active: boolean) => {
		if (!run) return <Text color={theme.muted}>Nothing run yet. Enter runs the highlighted task.</Text>;
		return (
			<Box flexDirection="column" flexGrow={1}>
				<Box height={1} flexShrink={0} gap={1}>
					<Text color={theme.muted}>$</Text>
					<Box flexShrink={1}><Text color={theme.text} wrap="truncate-end">{shellLine(run.task.argv)}</Text></Box>
					<Box flexGrow={1} />
					<Box flexShrink={0}><Status job={job} /></Box>
				</Box>
				{/* A new Pager for each run, so it follows the end again. */}
				<Pager key={run.id} text={job.lines} offset={job.dropped} follow ansi active={active} />
			</Box>
		);
	};

	return (
		<Box flexDirection="column" flexGrow={1}>
			<Text color={theme.muted} wrap="truncate-end">Enter runs a task · r runs the last one again · Ctrl-k stops it · Ctrl-w w scrolls the output</Text>
			<Split sizes={[2, 3]} panes={[list, output]} />
		</Box>
	);
}

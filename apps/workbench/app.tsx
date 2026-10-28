// workbench: a dashboard for the folder it starts in (`gui workbench`):
// files, git status and diffs, package.json and Makefile tasks, and the TCP
// ports in use.
//
// Permissions (gui.json). The sandbox also covers every task the app starts,
// so it has to grant what the project's scripts need:
// - write $CWD: tasks build, test and format the project, so they write into
//   it; writing implies reading, which the Files and Git tabs need. The rest
//   of your home stays closed, apart from what every app gets (its own
//   folder, its data folder, the kit, ~/.bun).
// - read $REPO: the git work tree around $CWD, so the Git tab also works when
//   workbench starts in a subfolder of a repo. git's global config
//   (~/.gitconfig, ~/.config/git) comes with run *.
// - read ~/.nvm: npm and node installed with nvm live there; without it
//   `npm run` cannot load npm itself. Toolchains elsewhere in your home
//   (cargo, pyenv, volta) would need their folder added the same way.
// - run *: a script runs whatever it likes (sh, node, tsc, make...), so the
//   commands cannot be listed in advance; git and lsof are covered by it.
// - net true: install, fetch or deploy scripts need the network.
// Not granted: writes to package caches in your home (~/.bun/install/cache,
// ~/.npm). Stopping a process on the Ports tab needs no permission.

import {basename} from 'node:path';
import {Shell, Tabs, useCallback, useEffect, useNotify, useProcess, useRef, useState, type Tab} from 'gui-kit';
import {FilesTab} from './files.js';
import {git, GitTab} from './git.js';
import type {Task} from './parse.js';
import {LSOF_PORTS, PortsTab, type PortSource} from './ports.js';
import {loadLastTab, saveLastTab} from './state.js';
import {TasksTab, type Run} from './tasks.js';

const TAB_IDS = ['files', 'git', 'tasks', 'ports'];

type Props = {
	/** The project folder; the folder the app started in by default. */
	cwd?: string;
	/** Where the last open tab is remembered; GUI_DATA_DIR by default, nowhere without it. */
	dataDir?: string;
	ports?: PortSource;
};

export default function Workbench({cwd = process.cwd(), dataDir = process.env['GUI_DATA_DIR'], ports = LSOF_PORTS}: Props) {
	const notify = useNotify();
	const [tab, setTab] = useState(() => {
		const last = loadLastTab(dataDir, cwd);
		return last && TAB_IDS.includes(last) ? last : 'files';
	});
	const [branch, setBranch] = useState<string | undefined>();

	// The task runs here, above the tabs, so switching tabs does not stop it.
	const job = useProcess();
	const [run, setRun] = useState<Run | undefined>();
	const runs = useRef(0);
	const reported = useRef(0);
	const start = useCallback((task: Task) => {
		setRun({id: ++runs.current, task});
		job.start(task.argv, {cwd});
	}, [job.start, cwd]);

	// One notification per run, once it has an outcome.
	useEffect(() => {
		if (!run || job.running || reported.current === run.id) return;
		const name = run.task.name;
		if (job.error) notify(`${name}: could not start: ${job.error}`, {kind: 'error'});
		else if (job.signal) notify(`${name}: stopped (${job.signal})`, {kind: 'warning'});
		else if (job.exitCode === 0) notify(`${name}: done (exit 0)`, {kind: 'success'});
		else if (job.exitCode !== null) notify(`${name}: failed (exit ${job.exitCode})`, {kind: 'error'});
		else return;
		reported.current = run.id;
	}, [run, job.running, job.exitCode, job.signal, job.error]);

	useEffect(() => {
		let live = true;
		// symbolic-ref also names a branch with no commits yet; it fails on a detached HEAD.
		void git(['symbolic-ref', '--short', '-q', 'HEAD'], cwd).then(result => {
			if (live && result.code === 0) setBranch(result.stdout.trim());
		});
		return () => {
			live = false;
		};
	}, [cwd]);

	const choose = (id: string) => {
		setTab(id);
		saveLastTab(dataDir, cwd, id);
	};

	const busy = job.running && run ? run.task.name : undefined;
	const tabs: Tab[] = [
		{id: 'files', title: 'Files', content: <FilesTab cwd={cwd} />},
		{id: 'git', title: 'Git', content: <GitTab cwd={cwd} />},
		{id: 'tasks', title: busy ? 'Tasks ●' : 'Tasks', content: <TasksTab cwd={cwd} job={job} run={run} onRun={start} />},
		{id: 'ports', title: 'Ports', content: <PortsTab source={ports} />},
	];
	const title = `workbench · ${basename(cwd) || cwd}${branch ? ` (${branch})` : ''}${busy ? ` · running ${busy}` : ''}`;
	return (
		<Shell title={title}>
			<Tabs tabs={tabs} selected={tab} onChange={choose} />
		</Shell>
	);
}

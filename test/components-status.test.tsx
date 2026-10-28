import {expect, test} from 'bun:test';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {Box, List, ProcessView, ProgressBar, Shell, Spinner, Text, useKeys, useNotify, useProcess, useState, type ProcessHandle} from '../src/kit/index.js';
import {headless} from '../src/kit/testing.js';

type App = Awaited<ReturnType<typeof headless>>;

/** Waits until the screen contains `text`, for things that take real time. */
async function until(app: App, text: string, ms = 3000) {
	const end = Date.now() + ms;
	while (!app.screen().includes(text)) {
		if (Date.now() > end) throw new Error(`"${text}" never showed up:\n${app.screen()}`);
		await app.settle(20);
	}
}

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

test('progress bar: eighth blocks, percent, and the width of its parent', async () => {
	const app = await headless(
		<Shell title="p">
			<ProgressBar value={0.55} width={10} percent />
			<ProgressBar value={1.7} width={4} label="over" />
			<ProgressBar value={1} />
			<Box><Text>row</Text><ProgressBar value={0.5} /></Box>
		</Shell>,
		{cols: 40, rows: 8},
	);
	expect(app.lines()[0]).toBe('█████▌      55%');
	expect(app.lines()[1]).toBe('over ████');
	expect(app.lines()[2]).toBe('█'.repeat(40));
	// In a row sized by its content the bar falls back to 20 cells.
	expect(app.lines()[3]).toBe('row' + '█'.repeat(10));
	await app.exit();
});

test('spinner: turns and shows its label', async () => {
	const app = await headless(<Shell title="s"><Spinner label="working" /></Shell>, {cols: 40, rows: 4});
	const first = app.lines()[0]!;
	expect(first).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] working$/);
	await app.settle(200);
	expect(app.lines()[0]).not.toBe(first);
	await app.exit();
});

function Notifier() {
	// Called above the Shell, as apps call useFinish.
	const notify = useNotify();
	useKeys([
		{keys: 'a', desc: 'Saved', run: () => notify('Saved', {kind: 'success', timeout: 120})},
		{keys: 'e', desc: 'Broken', run: () => notify('Broken pipe', {kind: 'error'})},
		{keys: 'i', desc: 'Info', run: () => notify('Hello')},
	]);
	return <Shell title="n"><Text>body</Text></Shell>;
}

test('notifications: stacked at the top right, timed out, errors stay until Esc', async () => {
	const app = await headless(<Notifier />, {cols: 100, rows: 30});
	await app.press('a');
	// One column from the right edge.
	expect(app.lines()[1]).toMatch(/│ ✓ Saved │$/);
	expect(app.lines()[1]).toHaveLength(99);
	await app.press('ei');
	expect(app.lines()[1]).toContain('✓ Saved');
	expect(app.lines()[4]).toContain('✗ Broken pipe');
	expect(app.lines()[7]).toContain('• Hello');
	expect(app.lines()[0]).toStartWith('body');
	await app.settle(150);
	expect(app.screen()).not.toContain('Saved');
	expect(app.lines()[1]).toContain('✗ Broken pipe');
	await app.settle(300);
	expect(app.screen()).toContain('Broken pipe');
	// The help comes first: Esc closes it and leaves the toasts.
	await app.press('?');
	expect(app.screen()).toContain('Dismiss notifications');
	await app.press('<Esc>');
	expect(app.screen()).toContain('Broken pipe');
	await app.press('<Esc>');
	expect(app.screen()).not.toContain('Broken pipe');
	expect(app.screen()).not.toContain('Hello');
	await app.exit();
});

test('useProcess: streams stdout and stderr, keeps the last lines, reports the exit', async () => {
	let handle: ReturnType<typeof useProcess> | undefined;
	function Runner() {
		const job = useProcess({maxLines: 5});
		handle = job;
		useKeys([
			{keys: 's', desc: 'Start', run: () => job.start(['sh', '-c', 'echo out; echo err 1>&2; sleep 0.05; echo $GREETING; exit 3'], {env: {GREETING: 'hi'}})},
			{keys: 'c', desc: 'Count', run: () => job.start(['seq', '1', '100'])},
			{keys: 'x', desc: 'Clear', run: () => job.clear()},
		]);
		return <Shell title="r"><Text>{`${job.running ? 'running' : 'idle'} code=${job.exitCode} ${job.lines.join(',')}`}</Text></Shell>;
	}
	const app = await headless(<Runner />, {cols: 80, rows: 6});
	await app.press('s');
	await until(app, 'code=3');
	expect([...handle!.lines].sort()).toEqual(['err', 'hi', 'out']);
	expect(handle!.lines.at(-1)).toBe('hi');
	expect(handle!.signal).toBeNull();
	await app.press('c');
	await until(app, 'idle code=0');
	expect(handle!.lines).toEqual(['96', '97', '98', '99', '100']);
	await app.press('x');
	expect(handle!.lines).toEqual([]);
	await app.exit();
});

test('useProcess: a command that does not exist reports an error', async () => {
	function Missing() {
		const job = useProcess();
		useKeys([{keys: 's', desc: 'Start', run: () => job.start(['gui-kit-no-such-command'])}]);
		return <Shell title="m"><Text>{job.error ? `error: ${job.error}` : 'none'}</Text></Shell>;
	}
	const app = await headless(<Missing />, {cols: 80, rows: 6});
	await app.press('s');
	expect(app.screen()).toContain('error:');
	await app.exit();
});

test('process view: header, output in a following pager, exit status, r reruns', async () => {
	const exits: (number | null)[] = [];
	const app = await headless(
		<Shell title="v"><ProcessView argv={['sh', '-c', 'echo a; echo b']} onExit={code => exits.push(code)} /></Shell>,
		{cols: 60, rows: 10},
	);
	await until(app, 'exit 0');
	expect(app.lines()[0]).toMatch(/^\$ sh -c 'echo a; echo b' +exit 0$/);
	expect(app.lines().slice(1, 3)).toEqual(['a', 'b']);
	expect(app.lines()[8]).toBe('1-2/2  FOLLOW');
	await app.press('r');
	await app.settle(200);
	await until(app, 'exit 0');
	expect(exits).toEqual([0, 0]);
	await app.exit();
});

test('process view: Ctrl-k kills the whole process group, a nonzero exit shows', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'gui-kit-'));
	const app = await headless(
		<Shell title="k"><ProcessView argv={['sh', '-c', `echo started; sleep 30 & echo $! > ${dir}/pid; wait`]} /></Shell>,
		{cols: 60, rows: 10},
	);
	await until(app, 'started');
	expect(app.lines()[0]).toContain('running');
	await app.settle(50);
	const sleeper = Number(readFileSync(join(dir, 'pid'), 'utf8'));
	expect(alive(sleeper)).toBe(true);
	await app.press('<C-k>');
	await until(app, 'killed (SIGTERM)');
	expect(alive(sleeper)).toBe(false);
	await app.exit();

	const failing = await headless(<Shell title="f"><ProcessView argv={['sh', '-c', 'exit 4']} /></Shell>, {cols: 60, rows: 6});
	await until(failing, 'exit 4');
	await failing.exit();
});

test('process view: Ctrl-c ends the app (Ink exits on it) and the unmount kills the command', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'gui-kit-'));
	function Toggle() {
		const [shown, setShown] = useState(true);
		useKeys([{keys: 'u', desc: 'Unmount', run: () => setShown(false)}]);
		return <Shell title="t">{shown ? <ProcessView argv={['sh', '-c', `echo $$ > ${dir}/pid; echo up; sleep 30`]} /> : <Text>gone</Text>}</Shell>;
	}
	const app = await headless(<Toggle />, {cols: 60, rows: 8});
	await until(app, 'up');
	const shell = Number(readFileSync(join(dir, 'pid'), 'utf8'));
	expect(alive(shell)).toBe(true);
	await app.press('u');
	await app.settle(100);
	expect(alive(shell)).toBe(false);
	await app.exit();

	const second = await headless(<Toggle />, {cols: 60, rows: 8});
	await until(second, 'up');
	const other = Number(readFileSync(join(dir, 'pid'), 'utf8'));
	await second.press('<C-c>');
	await second.settle(100);
	expect(second.exited()).toBe(true);
	expect(alive(other)).toBe(false);
	await second.exit();
});

test('progress bar: a negative width draws no bar instead of crashing; Infinity is clamped', async () => {
	const app = await headless(
		<Shell title="p">
			<ProgressBar value={0.5} width={-10} label="small" percent />
			<ProgressBar value={Infinity} width={4} percent />
			<ProgressBar value={-Infinity} width={4} percent />
			<ProgressBar value={Number.NaN} width={4} percent />
			<ProgressBar value={0.5} width={2.6} />
		</Shell>,
		{cols: 20, rows: 8},
	);
	expect(app.error()).toBeUndefined();
	expect(app.lines()[0]).toMatch(/^small +50%$/);
	expect(app.lines()[1]).toBe('████ 100%');
	expect(app.lines()[2]).toBe('       0%');
	expect(app.lines()[3]).toBe('       0%');
	expect(app.lines()[4]).toBe('█');
	await app.exit();
});

test('notifications: with an app Esc binding, :dismiss and a click still dismiss them', async () => {
	const backs: number[] = [];
	const opened: string[] = [];
	function Busy() {
		const notify = useNotify();
		useKeys([
			{keys: '<Esc>', desc: 'Back', run: () => backs.push(1)},
			{keys: 'e', desc: 'Error', run: () => notify('Build failed', {kind: 'error'})},
		]);
		return <Shell title="b"><List items={['first', 'second', 'third']} text={item => item} render={item => <Text>{item}</Text>} onOpen={item => opened.push(item)} /></Shell>;
	}
	const app = await headless(<Busy />, {cols: 60, rows: 10});
	await app.press('e<Esc>');
	// The app's Esc wins over the toasts' (priority -10).
	expect(backs).toEqual([1]);
	expect(app.screen()).toContain('✗ Build failed');
	await app.press(':dismiss<CR>');
	expect(app.screen()).not.toContain('Build failed');
	await app.press('e');
	const row = app.lines().findIndex(line => line.includes('Build failed'));
	const column = app.lines()[row]!.indexOf('Build failed');
	await app.mouse('down', column, row);
	expect(app.screen()).not.toContain('Build failed');
	// The click stopped at the toast: the list row under it was neither selected nor opened.
	expect(app.lines()[0]).toStartWith('▌first');
	await app.mouse('down', column, row);
	expect(app.lines()[row]).toStartWith('▌second');
	expect(opened).toEqual([]);
	await app.exit();
});

test('useProcess: dropped counts the lines cut to keep maxLines or by clear; runs counts the starts', async () => {
	let handle: ProcessHandle | undefined;
	function Counter() {
		const job = useProcess({maxLines: 5});
		handle = job;
		useKeys([
			{keys: 's', desc: 'Start', run: () => job.start(['seq', '1', '100'])},
			{keys: 'x', desc: 'Clear', run: () => job.clear()},
		]);
		return <Shell title="c"><Text>{`runs=${job.runs} dropped=${job.dropped} ${job.running ? 'running' : 'idle'} ${job.exitCode}`}</Text></Shell>;
	}
	const app = await headless(<Counter />, {cols: 60, rows: 6});
	expect(app.screen()).toContain('runs=0 dropped=0 idle');
	await app.press('s');
	await until(app, 'idle 0');
	expect(handle!.lines).toEqual(['96', '97', '98', '99', '100']);
	expect(handle!.dropped).toBe(95);
	await app.press('x');
	expect(handle!.dropped).toBe(100);
	await app.press('s');
	await until(app, 'runs=2 dropped=95 idle 0');
	await app.exit();
});

test('process view: the scrollback stays put while maxLines cuts old lines', async () => {
	function Busy() {
		const job = useProcess({maxLines: 50});
		const argv = ['sh', '-c', 'seq 1 100; i=101; while [ $i -le 2000 ]; do echo $i; i=$((i+1)); sleep 0.02; done'];
		useKeys([{keys: 's', desc: 'Start', run: () => job.start(argv)}]);
		return <Shell title="b"><ProcessView job={job} argv={argv} /></Shell>;
	}
	const app = await headless(<Busy />, {cols: 60, rows: 10});
	await app.press('s');
	// Past the first 100 lines, so lines are being cut.
	await until(app, '120');
	await app.press('20k');
	const first = app.lines()[1];
	const position = app.lines()[8]!.split('/')[0];
	await app.settle(400);
	expect(app.lines()[1]).toBe(first);
	expect(app.lines()[8]!.split('/')[0]).toBe(position);
	await app.exit();
});

test('process view: onExit also fires when the command cannot start, on every rerun', async () => {
	const exits: unknown[][] = [];
	const app = await headless(
		<Shell title="m"><ProcessView argv={['gui-kit-no-such-command']} onExit={(...args) => exits.push(args)} /></Shell>,
		{cols: 80, rows: 6},
	);
	await until(app, 'failed:');
	expect(exits).toHaveLength(1);
	expect(exits[0]!.slice(0, 2)).toEqual([null, null]);
	expect(String(exits[0]![2])).toContain('gui-kit-no-such-command');
	await app.press('r');
	await app.settle(50);
	expect(exits).toHaveLength(2);
	await app.exit();

	const cwdExits: unknown[][] = [];
	const badCwd = await headless(
		<Shell title="c"><ProcessView argv={['true']} cwd="/no/such/dir" onExit={(...args) => cwdExits.push(args)} /></Shell>,
		{cols: 80, rows: 6},
	);
	await until(badCwd, 'failed:');
	expect(cwdExits).toHaveLength(1);
	expect(cwdExits[0]!.slice(0, 2)).toEqual([null, null]);
	expect(typeof cwdExits[0]![2]).toBe('string');
	await badCwd.exit();

	// A normal run still reports (code, signal) only.
	const normal: unknown[][] = [];
	const ok = await headless(<Shell title="o"><ProcessView argv={['true']} onExit={(...args) => normal.push(args)} /></Shell>, {cols: 60, rows: 6});
	await until(ok, 'exit 0');
	expect(normal).toEqual([[0, null]]);
	await ok.exit();
});

test('process view: an external job is only shown; it outlives the view and r restarts it', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'gui-kit-'));
	const exits: unknown[][] = [];
	function Owner() {
		const job = useProcess();
		const [shown, setShown] = useState(true);
		useKeys([
			{keys: 's', desc: 'Start', run: () => job.start(['sh', '-c', `echo $$ > ${dir}/pid; echo first; sleep 30`])},
			{keys: 'u', desc: 'Toggle', run: () => setShown(current => !current)},
		]);
		return (
			<Shell title="o">
				{shown ? <ProcessView job={job} argv={['sh', '-c', 'echo again']} onExit={(...args) => exits.push(args)} /> : <Text>{`hidden ${job.running ? 'running' : 'idle'}`}</Text>}
			</Shell>
		);
	}
	const app = await headless(<Owner />, {cols: 60, rows: 8});
	// Nothing starts on mount.
	await app.settle(100);
	expect(app.screen()).toContain('empty');
	expect(app.screen()).not.toContain('running');
	await app.press('s');
	await until(app, 'first');
	const shell = Number(readFileSync(join(dir, 'pid'), 'utf8'));
	await app.press('u');
	expect(app.screen()).toContain('hidden running');
	await app.settle(100);
	expect(alive(shell)).toBe(true);
	await app.press('u');
	expect(app.screen()).toContain('first');
	expect(app.lines()[0]).toContain('running');
	await app.press('<C-k>');
	await until(app, 'killed (SIGTERM)');
	expect(exits).toEqual([[null, 'SIGTERM']]);
	// Shown again after the run ended: not reported twice.
	await app.press('uu');
	expect(exits).toEqual([[null, 'SIGTERM']]);
	await app.press('r');
	await until(app, 'exit 0');
	expect(app.screen()).toContain('again');
	expect(exits).toEqual([[null, 'SIGTERM'], [0, null]]);
	await app.exit();
});

function Toggle({argv}: {argv: string[]}) {
	const [shown, setShown] = useState(true);
	useKeys([{keys: 'u', desc: 'Unmount', run: () => setShown(false)}]);
	return <Shell title="t">{shown ? <ProcessView argv={argv} /> : <Text>gone</Text>}</Shell>;
}

const ignoresTerm = (dir: string) => ['sh', '-c', `trap '' TERM; sleep 30 & echo $! > ${dir}/pid; echo up; wait`];

test('process view: unmounting sends SIGKILL to a group that ignores SIGTERM, after a grace period', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'gui-kit-'));
	const app = await headless(<Toggle argv={ignoresTerm(dir)} />, {cols: 60, rows: 8});
	await until(app, 'up');
	const sleeper = Number(readFileSync(join(dir, 'pid'), 'utf8'));
	await app.press('u');
	await app.settle(200);
	expect(alive(sleeper)).toBe(true);
	await app.settle(2200);
	expect(alive(sleeper)).toBe(false);
	await app.exit();
}, 10_000);

test('process view: a second Ctrl-k sends SIGKILL', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'gui-kit-'));
	const app = await headless(<Shell title="k"><ProcessView argv={ignoresTerm(dir)} /></Shell>, {cols: 60, rows: 8});
	await until(app, 'up');
	const sleeper = Number(readFileSync(join(dir, 'pid'), 'utf8'));
	await app.press('<C-k>');
	await app.settle(150);
	expect(app.lines()[0]).toContain('running');
	await app.press('<C-k>');
	await until(app, 'killed (SIGKILL)');
	await app.settle(50);
	expect(alive(sleeper)).toBe(false);
	await app.exit();
});

test('process view: what the command left running after it exited is still stopped', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'gui-kit-'));
	const argv = ['sh', '-c', `sleep 30 >/dev/null 2>&1 & echo $! > ${dir}/pid; echo started`];
	const app = await headless(<Toggle argv={argv} />, {cols: 60, rows: 8});
	await until(app, 'exit 0');
	const first = Number(readFileSync(join(dir, 'pid'), 'utf8'));
	expect(alive(first)).toBe(true);
	await app.press('<C-k>');
	await app.settle(100);
	expect(alive(first)).toBe(false);
	await app.press('r');
	await until(app, 'exit 0');
	await app.settle(50);
	const second = Number(readFileSync(join(dir, 'pid'), 'utf8'));
	expect(second).not.toBe(first);
	expect(alive(second)).toBe(true);
	await app.press('u');
	await app.settle(100);
	expect(alive(second)).toBe(false);
	await app.exit();
});

test('process view: an app that exits right after unmounting still kills a group that ignores SIGTERM', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'gui-kit-'));
	const root = resolve(import.meta.dir, '..');
	// No JSX, so the script needs no React runtime next to it.
	const script = join(dir, 'quit.ts');
	writeFileSync(script, [
		`import {createElement as h} from ${JSON.stringify(join(root, 'node_modules/react/index.js'))};`,
		`import {ProcessView, Shell} from ${JSON.stringify(join(root, 'src/kit/index.ts'))};`,
		`import {headless} from ${JSON.stringify(join(root, 'src/kit/testing.tsx'))};`,
		`const app = await headless(h(Shell, {title: 'q'}, h(ProcessView, {argv: ${JSON.stringify(ignoresTerm(dir))}})), {cols: 60, rows: 6});`,
		`while (!app.screen().includes('up')) await app.settle(20);`,
		'await app.exit();',
		'process.exit(0);',
	].join('\n'));
	const started = performance.now();
	const result = Bun.spawnSync(['bun', script], {cwd: root, stderr: 'pipe'});
	expect(result.exitCode).toBe(0);
	// It waited for the group at most half a second, not the two-second timer.
	expect(performance.now() - started).toBeLessThan(1900);
	expect(existsSync(join(dir, 'pid'))).toBe(true);
	const sleeper = Number(readFileSync(join(dir, 'pid'), 'utf8'));
	await Bun.sleep(50);
	expect(alive(sleeper)).toBe(false);
}, 10_000);

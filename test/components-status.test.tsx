import {expect, test} from 'bun:test';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Box, ProcessView, ProgressBar, Shell, Spinner, Text, useKeys, useNotify, useProcess, useState} from '../src/kit/index.js';
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

import {useCallback, useEffect, useRef, useState} from 'react';
import {Box, Text} from 'ink';
import type {Subprocess} from 'bun';
import {useKeys} from '../context.js';
import {theme} from '../theme.js';
import {Pager} from './Pager.js';
import {Spinner} from './Progress.js';

export type StartOptions = {
	cwd?: string;
	/** Added to the app's environment. */
	env?: Record<string, string | undefined>;
};

export type ProcessHandle = {
	/** stdout and stderr together, line by line, as they arrive. Escapes are left in; Pager removes them. */
	lines: string[];
	/** Lines cut from the front of `lines` in this run, to keep `maxLines` or by clear(); pass it to Pager's `offset`. */
	dropped: number;
	/** How many times start() has been called: a new value is a new run. 0 before the first. */
	runs: number;
	running: boolean;
	/** Set once the process has exited on its own. */
	exitCode: number | null;
	/** Set when a signal ended it, e.g. after kill(). */
	signal: string | null;
	/** Why the command could not start, e.g. it does not exist. */
	error: string | undefined;
	/** Starts the command, after stopping the previous run's process group (SIGTERM, then SIGKILL). */
	start: (argv: string[], options?: StartOptions) => void;
	/** Sends a signal (SIGTERM by default) to the run's process group, also after the command itself has exited. */
	kill: (signal?: NodeJS.Signals) => void;
	clear: () => void;
};

type State = Omit<ProcessHandle, 'start' | 'kill' | 'clear'>;

const IDLE: State = {lines: [], dropped: 0, runs: 0, running: false, exitCode: null, signal: null, error: undefined};

/** Time a process group gets after SIGTERM before SIGKILL, when a run is replaced or unmounted. */
const KILL_AFTER_MS = 2000;
/** How long an exiting app waits for those groups before it sends SIGKILL. */
const EXIT_WAIT_MS = 500;

/** Signals every process in a group; false when none is left (or none may be signalled). */
function signalGroup(pgid: number, signal: NodeJS.Signals | 0): boolean {
	try {
		process.kill(-pgid, signal);
		return true;
	} catch {
		return false;
	}
}

// Groups sent SIGTERM whose SIGKILL is still due. An app that quits does not
// wait for the timers, so on exit it gives them a moment and kills the rest.
const stopping = new Map<number, ReturnType<typeof setTimeout>>();
let exitHook = false;

function killStopping() {
	const end = Date.now() + EXIT_WAIT_MS;
	for (const pgid of stopping.keys()) {
		// A leader that has died but was not reaped answers EPERM, which counts as gone.
		while (Date.now() < end && signalGroup(pgid, 0)) Bun.sleepSync(10);
		signalGroup(pgid, 'SIGKILL');
	}
	stopping.clear();
}

/** SIGTERM to a whole process group, then SIGKILL after KILL_AFTER_MS to whatever ignored it. */
function stopGroup(pgid: number) {
	clearTimeout(stopping.get(pgid));
	stopping.delete(pgid);
	if (!signalGroup(pgid, 'SIGTERM')) return;
	const timer = setTimeout(() => {
		stopping.delete(pgid);
		signalGroup(pgid, 'SIGKILL');
	}, KILL_AFTER_MS);
	// The timer must not keep a finished app alive; the exit hook covers it.
	timer.unref?.();
	stopping.set(pgid, timer);
	if (!exitHook) {
		exitHook = true;
		process.on('exit', killStopping);
	}
}

/**
 * Runs a command and streams its output, keeping the last `maxLines` lines.
 * The child gets its own process group, and it cannot read the app's
 * terminal. Replacing a run or unmounting stops the whole group, what the
 * command started included (`sh -c 'sleep 9 &'`), even after the command
 * itself has exited: SIGTERM, then SIGKILL two seconds later, or when the
 * app exits.
 */
export function useProcess({maxLines = 10_000}: {maxLines?: number} = {}): ProcessHandle {
	const [state, setState] = useState<State>(IDLE);
	const child = useRef<Subprocess | undefined>(undefined);
	// The run's process group (the leader's pid). It outlives the leader while
	// anything it started is still in it; a pid is not reused while its group exists.
	const group = useRef<number | undefined>(undefined);
	const buffer = useRef<string[]>([]);
	const dropped = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	// Each start bumps it, so output still arriving from a replaced process is dropped.
	const generation = useRef(0);

	// Lines are drawn in batches, not one render per line.
	const flush = useCallback(() => {
		clearTimeout(timer.current);
		timer.current = undefined;
		const extra = buffer.current.length - maxLines;
		if (extra > 0) {
			buffer.current.splice(0, extra);
			dropped.current += extra;
		}
		const lines = buffer.current.slice();
		const cut = dropped.current;
		setState(current => ({...current, lines, dropped: cut}));
	}, [maxLines]);

	const kill = useCallback((signal: NodeJS.Signals = 'SIGTERM') => {
		const pgid = group.current;
		if (pgid === undefined) return;
		if (!signalGroup(pgid, signal)) child.current?.kill(signal);
	}, []);

	/** Lets go of the current run: its group gets SIGTERM, then SIGKILL. */
	const stop = useCallback(() => {
		if (group.current !== undefined) stopGroup(group.current);
		group.current = undefined;
		child.current = undefined;
	}, []);

	const start = useCallback((argv: string[], {cwd, env}: StartOptions = {}) => {
		stop();
		const run = ++generation.current;
		buffer.current = [];
		dropped.current = 0;
		let proc: Subprocess<'ignore', 'pipe', 'pipe'>;
		try {
			proc = Bun.spawn(argv, {
				...(cwd ? {cwd} : {}),
				env: {...process.env, ...env},
				stdin: 'ignore',
				stdout: 'pipe',
				stderr: 'pipe',
				detached: true,
			});
		} catch (error) {
			setState({...IDLE, runs: run, error: error instanceof Error ? error.message : String(error)});
			return;
		}
		child.current = proc;
		group.current = proc.pid;
		setState({...IDLE, runs: run, running: true});

		const read = async (stream: ReadableStream<Uint8Array>) => {
			const decoder = new TextDecoder();
			let rest = '';
			for await (const chunk of stream) {
				if (run !== generation.current) return;
				const parts = (rest + decoder.decode(chunk, {stream: true})).split('\n');
				rest = parts.pop()!;
				buffer.current.push(...parts);
				timer.current ??= setTimeout(flush, 30);
			}
			rest += decoder.decode();
			if (rest && run === generation.current) buffer.current.push(rest);
		};
		// A stream that fails only ends the output early; the exit still counts.
		void Promise.allSettled([read(proc.stdout), read(proc.stderr), proc.exited]).then(() => {
			if (run !== generation.current) return;
			child.current = undefined;
			// Keep the group while something the command started still runs in it.
			if (!signalGroup(proc.pid, 0)) group.current = undefined;
			flush();
			setState(current => ({...current, running: false, exitCode: proc.exitCode, signal: proc.signalCode === null ? null : String(proc.signalCode)}));
		});
	}, [stop, flush]);

	const clear = useCallback(() => {
		dropped.current += buffer.current.length;
		buffer.current = [];
		const cut = dropped.current;
		setState(current => ({...current, lines: [], dropped: cut}));
	}, []);

	useEffect(() => () => {
		generation.current++;
		clearTimeout(timer.current);
		stop();
	}, [stop]);

	return {...state, start, kill, clear};
}

/** argv as a shell would need it typed. */
function quote(argv: string[]): string {
	return argv.map(arg => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll('\'', '\'\\\'\'')}'`)).join(' ');
}

type ViewProps = {
	/** Shown in the header; run when the view mounts and on every rerun. */
	argv: string[];
	cwd?: string;
	env?: Record<string, string | undefined>;
	active?: boolean;
	/**
	 * Once per run, when it ends: (code, null) when it exits, (null, signal)
	 * when a signal ends it, (null, null, error) when it cannot start (not
	 * found, a bad cwd, not in permissions.run).
	 */
	onExit?: (exitCode: number | null, signal: string | null, error?: string) => void;
	/**
	 * A command owned higher up, from useProcess(), e.g. above a Tabs so it
	 * survives a tab switch. The view then only shows it: nothing starts on
	 * mount, unmounting does not stop it, and r restarts it through this
	 * handle with argv, cwd and env.
	 */
	job?: ProcessHandle;
};

/**
 * Runs a command when it mounts and shows it: the command line, a spinner
 * while it runs, then its exit status, over the output in a following Pager.
 * r runs it again; Ctrl-k kills it (SIGTERM, a second Ctrl-k SIGKILL).
 * Ctrl-c cannot be the kill key: Ink exits on it before useInput sees it
 * (exitOnCtrlC is on, RENDER_OPTIONS leaves it so), and the unmount then
 * kills the command anyway.
 */
export function ProcessView({argv, cwd, env, active = true, onExit, job: external}: ViewProps) {
	const own = useProcess();
	const job = external ?? own;
	const start = () => job.start(argv, {...(cwd ? {cwd} : {}), ...(env ? {env} : {})});
	useEffect(() => {
		if (!external) start();
	}, []);

	// The last run whose end was reported. A run that is over when the view
	// mounts (an external job) counts as reported, so a tab switch does not
	// report it again.
	const reported = useRef(job.running ? job.runs - 1 : job.runs);
	useEffect(() => {
		if (job.running || job.runs === reported.current) return;
		reported.current = job.runs;
		if (job.error === undefined) onExit?.(job.exitCode, job.signal);
		else onExit?.(null, null, job.error);
	}, [job.runs, job.running]);

	// A second Ctrl-k in the same run sends SIGKILL, for commands that ignore
	// SIGTERM. It also reaches what the command left running after it exited.
	const terminated = useRef(-1);
	const kill = () => {
		job.kill(terminated.current === job.runs ? 'SIGKILL' : 'SIGTERM');
		terminated.current = job.runs;
	};

	useKeys(
		[
			{keys: 'r', desc: 'Run again', group: 'Process', run: start},
			{keys: '<C-k>', desc: 'Kill the process (again: SIGKILL)', group: 'Process', run: kill},
		],
		{active},
	);

	const status = job.running ? <Spinner label="running" />
		: job.error ? <Text color={theme.danger}>{`failed: ${job.error}`}</Text>
		: job.signal ? <Text color={theme.warning}>{`killed (${job.signal})`}</Text>
		: job.exitCode !== null ? <Text color={job.exitCode === 0 ? theme.success : theme.danger}>{`exit ${job.exitCode}`}</Text>
		: null;
	return (
		<Box flexDirection="column" flexGrow={1}>
			<Box height={1} gap={1} flexShrink={0}>
				<Text color={theme.muted}>$</Text>
				<Box flexShrink={1}>
					<Text color={theme.text} wrap="truncate-end">{quote(argv)}</Text>
				</Box>
				<Box flexGrow={1} />
				<Box flexShrink={0}>{status}</Box>
			</Box>
			{/* A new Pager for each run, so it follows the end again. */}
			<Pager key={job.runs} text={job.lines} offset={job.dropped} follow active={active} />
		</Box>
	);
}

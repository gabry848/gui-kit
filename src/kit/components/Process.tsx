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
	/**
	 * Sends a signal (SIGTERM by default) to the run's process group, also
	 * after the command itself has exited, while what it started still runs.
	 * Once the group is gone it sends nothing.
	 */
	kill: (signal?: NodeJS.Signals) => void;
	clear: () => void;
};

type State = Omit<ProcessHandle, 'start' | 'kill' | 'clear'>;

const IDLE: State = {lines: [], dropped: 0, runs: 0, running: false, exitCode: null, signal: null, error: undefined};

/** Time a process group gets after SIGTERM before SIGKILL, when a run is replaced or unmounted. */
const KILL_AFTER_MS = 2000;
/** How long an exiting app waits for those groups before it sends SIGKILL. */
const EXIT_WAIT_MS = 500;
/**
 * How often a group is checked once its leader has exited: when the last
 * process in it ends, the pgid is forgotten, because from then on that pid
 * can come back as the group of an unrelated program.
 */
const WATCH_MS = 500;
/** The same check for a group sent SIGTERM, while its SIGKILL is due. */
const STOP_POLL_MS = 100;

/** Signals every process in a group; false when none is left (or none may be signalled). */
function signalGroup(pgid: number, signal: NodeJS.Signals | 0): boolean {
	try {
		process.kill(-pgid, signal);
		return true;
	} catch {
		return false;
	}
}

// Groups sent SIGTERM whose SIGKILL is still due, each with the timer that
// checks on it. An app that quits does not wait for the timers, so on exit it
// gives them a moment and kills the rest.
const stopping = new Map<number, ReturnType<typeof setInterval>>();
let exitHook = false;

/** Drops a group from `stopping`, with the SIGKILL it was due. */
function forgetStopping(pgid: number) {
	clearInterval(stopping.get(pgid));
	stopping.delete(pgid);
}

function killStopping() {
	const end = Date.now() + EXIT_WAIT_MS;
	for (const [pgid, timer] of stopping) {
		clearInterval(timer);
		// A leader that has died but was not reaped answers EPERM, which counts as gone.
		while (Date.now() < end && signalGroup(pgid, 0)) Bun.sleepSync(10);
		// Only to a group still there: a group that is gone may have left its pid to another one.
		if (signalGroup(pgid, 0)) signalGroup(pgid, 'SIGKILL');
	}
	stopping.clear();
}

/**
 * SIGTERM to a whole process group, then SIGKILL after KILL_AFTER_MS to
 * whatever ignored it. The group is checked every STOP_POLL_MS and forgotten
 * as soon as it is gone, so the SIGKILL never reaches a group that took its pid.
 */
function stopGroup(pgid: number) {
	forgetStopping(pgid);
	if (!signalGroup(pgid, 'SIGTERM')) return;
	const deadline = Date.now() + KILL_AFTER_MS;
	const timer = setInterval(() => {
		if (!signalGroup(pgid, 0)) {
			forgetStopping(pgid);
		} else if (Date.now() >= deadline) {
			forgetStopping(pgid);
			signalGroup(pgid, 'SIGKILL');
		}
	}, STOP_POLL_MS);
	// The timer must not keep a finished app alive; the exit hook covers it.
	timer.unref?.();
	stopping.set(pgid, timer);
	if (!exitHook) {
		exitHook = true;
		process.on('exit', killStopping);
	}
}

export type ProcessOptions = {
	/** Lines kept; older ones are cut from the front (see `dropped`). 10,000 by default. */
	maxLines?: number;
	/**
	 * Once per run, when it ends: (code, null) when it exits, (null, signal)
	 * when a signal ends it, (null, null, error) when it cannot start (not
	 * found, a bad cwd, not in permissions.run). A run ends when the command
	 * has exited and its output is closed, as `running` turns false. Not
	 * called for a run that start() replaces before it ends, nor after the
	 * component that owns the handle unmounts.
	 */
	onExit?: (exitCode: number | null, signal: string | null, error?: string) => void;
};

/**
 * Runs a command and streams its output, keeping the last `maxLines` lines.
 * The child gets its own process group, and it cannot read the app's
 * terminal. Replacing a run or unmounting stops the whole group, what the
 * command started included (`sh -c 'sleep 9 &'`), even after the command
 * itself has exited: SIGTERM, then SIGKILL two seconds later, or when the
 * app exits. A group is signalled only while it is still the run's own:
 * once the last process in it ends (checked every half second, and right
 * before each signal), its pgid is forgotten, so a later kill() or stop
 * cannot reach a program that reuses that pid. `onExit` reports the end of
 * every run.
 */
export function useProcess({maxLines = 10_000, onExit}: ProcessOptions = {}): ProcessHandle {
	const [state, setState] = useState<State>(IDLE);
	const child = useRef<Subprocess | undefined>(undefined);
	// The run's process group (the leader's pid). It outlives the leader while
	// anything it started is still in it. While the leader lives its pid is
	// taken, so the group is surely this run's; after that, only until the
	// group is seen empty, and then it is forgotten.
	const group = useRef<number | undefined>(undefined);
	const leader = useRef(false);
	const watch = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
	const buffer = useRef<string[]>([]);
	const dropped = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	// Each start bumps it, so output still arriving from a replaced process is dropped.
	const generation = useRef(0);
	const mounted = useRef(true);
	const latestExit = useRef(onExit);
	latestExit.current = onExit;

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

	const unwatch = useCallback(() => {
		clearInterval(watch.current);
		watch.current = undefined;
	}, []);

	/**
	 * The run's group if it is still the one this run started; checked right
	 * before every signal. A group that is gone is forgotten, with the
	 * SIGKILL it may still be due.
	 */
	const ownGroup = useCallback((): number | undefined => {
		const pgid = group.current;
		if (pgid === undefined || leader.current || signalGroup(pgid, 0)) return pgid;
		group.current = undefined;
		forgetStopping(pgid);
		unwatch();
		return undefined;
	}, [unwatch]);

	const kill = useCallback((signal: NodeJS.Signals = 'SIGTERM') => {
		const pgid = ownGroup();
		if (pgid === undefined) return;
		if (!signalGroup(pgid, signal)) child.current?.kill(signal);
	}, [ownGroup]);

	/** Lets go of the current run: its group gets SIGTERM, then SIGKILL. */
	const stop = useCallback(() => {
		const pgid = ownGroup();
		unwatch();
		if (pgid !== undefined) stopGroup(pgid);
		group.current = undefined;
		child.current = undefined;
		leader.current = false;
	}, [ownGroup, unwatch]);

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
			const message = error instanceof Error ? error.message : String(error);
			setState({...IDLE, runs: run, error: message});
			// After the caller's own code, as for a run that ends later; this
			// run is over, so a start() right after it does not cancel it.
			queueMicrotask(() => {
				if (mounted.current) latestExit.current?.(null, null, message);
			});
			return;
		}
		child.current = proc;
		group.current = proc.pid;
		leader.current = true;
		setState({...IDLE, runs: run, running: true});

		// Once the leader has exited, its pid is free: watch the group, so it
		// is forgotten soon after the last process in it ends.
		void proc.exited.then(() => {
			if (run !== generation.current) return;
			leader.current = false;
			if (ownGroup() !== undefined && watch.current === undefined) {
				watch.current = setInterval(() => {
					if (run === generation.current) ownGroup();
					else unwatch();
				}, WATCH_MS);
				watch.current.unref?.();
			}
		}, () => {});

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
			leader.current = false;
			// Keeps the group while something the command started still runs in it.
			ownGroup();
			flush();
			const signal = proc.signalCode === null ? null : String(proc.signalCode);
			setState(current => ({...current, running: false, exitCode: proc.exitCode, signal}));
			latestExit.current?.(signal === null ? proc.exitCode : null, signal);
		});
	}, [stop, flush, ownGroup, unwatch]);

	const clear = useCallback(() => {
		dropped.current += buffer.current.length;
		buffer.current = [];
		const cut = dropped.current;
		setState(current => ({...current, lines: [], dropped: cut}));
	}, []);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			generation.current++;
			clearTimeout(timer.current);
			stop();
		};
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
	 * found, a bad cwd, not in permissions.run). With `job`, only for runs
	 * that end while the view is mounted: to hear about every run, give
	 * `onExit` to the useProcess() that made the job.
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
	const latestExit = useRef(onExit);
	latestExit.current = onExit;
	// The view's own runs are reported by useProcess itself, where each one ends.
	const own = useProcess({onExit: (code, signal, error) => {
		if (!external) latestExit.current?.(code, signal, error);
	}});
	const job = external ?? own;
	const start = () => job.start(argv, {...(cwd ? {cwd} : {}), ...(env ? {env} : {})});
	useEffect(() => {
		if (!external) start();
	}, []);

	// An external job's runs are seen here, as they end while the view is
	// mounted. A run that is over when the view mounts counts as reported, so
	// a tab switch does not report it again.
	const reported = useRef(job.running ? job.runs - 1 : job.runs);
	useEffect(() => {
		if (!external || job.running || job.runs === reported.current) return;
		reported.current = job.runs;
		if (job.error === undefined) latestExit.current?.(job.exitCode, job.signal);
		else latestExit.current?.(null, null, job.error);
	}, [external, job.runs, job.running]);

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

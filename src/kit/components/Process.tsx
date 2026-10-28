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
	running: boolean;
	/** Set once the process has exited on its own. */
	exitCode: number | null;
	/** Set when a signal ended it, e.g. after kill(). */
	signal: string | null;
	/** Why the command could not start, e.g. it does not exist. */
	error: string | undefined;
	/** Starts the command, after killing the one still running. */
	start: (argv: string[], options?: StartOptions) => void;
	kill: (signal?: NodeJS.Signals) => void;
	clear: () => void;
};

type State = Omit<ProcessHandle, 'start' | 'kill' | 'clear'>;

const IDLE: State = {lines: [], running: false, exitCode: null, signal: null, error: undefined};

/**
 * Runs a command and streams its output, keeping the last `maxLines` lines.
 * The child gets its own process group, so kill() and unmounting also stop
 * what it started (`sh -c 'sleep 9'`), and it cannot read the app's terminal.
 */
export function useProcess({maxLines = 10_000}: {maxLines?: number} = {}): ProcessHandle {
	const [state, setState] = useState<State>(IDLE);
	const child = useRef<Subprocess | undefined>(undefined);
	const buffer = useRef<string[]>([]);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	// Each start bumps it, so output still arriving from a replaced process is dropped.
	const generation = useRef(0);

	// Lines are drawn in batches, not one render per line.
	const flush = useCallback(() => {
		clearTimeout(timer.current);
		timer.current = undefined;
		if (buffer.current.length > maxLines) buffer.current.splice(0, buffer.current.length - maxLines);
		const lines = buffer.current.slice();
		setState(current => ({...current, lines}));
	}, [maxLines]);

	const kill = useCallback((signal: NodeJS.Signals = 'SIGTERM') => {
		const proc = child.current;
		if (!proc) return;
		try {
			process.kill(-proc.pid, signal);
		} catch {
			proc.kill(signal);
		}
	}, []);

	const start = useCallback((argv: string[], {cwd, env}: StartOptions = {}) => {
		kill();
		const run = ++generation.current;
		buffer.current = [];
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
			child.current = undefined;
			setState({...IDLE, error: error instanceof Error ? error.message : String(error)});
			return;
		}
		child.current = proc;
		setState({...IDLE, running: true});

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
			flush();
			setState(current => ({...current, running: false, exitCode: proc.exitCode, signal: proc.signalCode === null ? null : String(proc.signalCode)}));
		});
	}, [kill, flush]);

	const clear = useCallback(() => {
		buffer.current = [];
		setState(current => ({...current, lines: []}));
	}, []);

	useEffect(() => () => {
		generation.current++;
		clearTimeout(timer.current);
		kill();
	}, [kill]);

	return {...state, start, kill, clear};
}

/** argv as a shell would need it typed. */
function quote(argv: string[]): string {
	return argv.map(arg => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll('\'', '\'\\\'\'')}'`)).join(' ');
}

type ViewProps = {
	/** Read when the view mounts and on every rerun. */
	argv: string[];
	cwd?: string;
	env?: Record<string, string | undefined>;
	active?: boolean;
	onExit?: (exitCode: number | null, signal: string | null) => void;
};

/**
 * Runs a command when it mounts and shows it: the command line, a spinner
 * while it runs, then its exit status, over the output in a following Pager.
 * r runs it again; Ctrl-k kills it. Ctrl-c cannot be the kill key: Ink exits
 * on it before useInput sees it (exitOnCtrlC is on, RENDER_OPTIONS leaves it
 * so), and the unmount then kills the command anyway.
 */
export function ProcessView({argv, cwd, env, active = true, onExit}: ViewProps) {
	const job = useProcess();
	const start = () => job.start(argv, {...(cwd ? {cwd} : {}), ...(env ? {env} : {})});
	useEffect(start, []);
	// A new Pager for each rerun, so it follows the end again.
	const [run, setRun] = useState(0);
	const rerun = () => {
		start();
		setRun(current => current + 1);
	};

	const wasRunning = useRef(false);
	useEffect(() => {
		if (wasRunning.current && !job.running) onExit?.(job.exitCode, job.signal);
		wasRunning.current = job.running;
	}, [job.running]);

	useKeys(
		[
			{keys: 'r', desc: 'Run again', group: 'Process', run: rerun},
			{keys: '<C-k>', desc: 'Kill the process', group: 'Process', run: () => job.kill()},
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
			<Pager key={run} text={job.lines} follow active={active} />
		</Box>
	);
}

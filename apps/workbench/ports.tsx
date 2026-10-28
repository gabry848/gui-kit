// Ports: who listens on which TCP port, and dd to stop one with SIGTERM.

import {Box, Confirm, Table, Text, theme, useEffect, useKeys, useNotify, useRef, useState, type Column} from 'gui-kit';
import {exec, firstLine} from './exec.js';
import {parseLsof, type Port} from './parse.js';

/** Where the ports come from and how a process is stopped; tests pass fakes. */
export type PortSource = {
	list: () => Promise<Port[]>;
	stop: (pid: number) => void;
};

export const LSOF_PORTS: PortSource = {
	async list() {
		// +c 0: whole command names, not the first 9 characters.
		const result = await exec(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '+c', '0']);
		// lsof exits 1 when nothing listens, with nothing on stderr.
		if (result.code !== 0 && (result.code !== 1 || result.stderr.trim())) {
			throw new Error(firstLine(result.stderr) || `lsof exited with ${result.code}`);
		}
		return parseLsof(result.stdout);
	},
	stop(pid) {
		process.kill(pid, 'SIGTERM');
	},
};

const COLUMNS: Column<Port>[] = [
	{key: 'command', title: 'Command'},
	{key: 'pid', title: 'PID', align: 'right'},
	{key: 'user', title: 'User'},
	{key: 'address', title: 'Address'},
];

/** Time for a process to exit before the list is read again. */
const AFTER_STOP_MS = 400;

export function PortsTab({source}: {source: PortSource}) {
	const notify = useNotify();
	const [ports, setPorts] = useState<Port[] | undefined>();
	const [error, setError] = useState<string | undefined>();
	const [selected, setSelected] = useState<Port | undefined>();
	const [asking, setAsking] = useState<Port | undefined>();
	const [version, setVersion] = useState(0);
	const mounted = useRef(true);
	useEffect(() => () => {
		mounted.current = false;
	}, []);

	useEffect(() => {
		let live = true;
		source.list().then(
			list => {
				if (!live) return;
				setPorts(list);
				setError(undefined);
			},
			(reason: unknown) => {
				if (live) setError(reason instanceof Error ? reason.message : String(reason));
			},
		);
		return () => {
			live = false;
		};
	}, [source, version]);

	const refresh = () => setVersion(current => current + 1);

	const answer = (yes: boolean) => {
		const port = asking;
		setAsking(undefined);
		if (!yes || !port) return;
		if (port.pid === process.pid) {
			notify('That is workbench itself: quit with q instead', {kind: 'warning'});
			return;
		}
		try {
			source.stop(port.pid);
			notify(`Sent SIGTERM to ${port.command} (pid ${port.pid})`, {kind: 'success'});
		} catch (reason) {
			const code = (reason as NodeJS.ErrnoException).code;
			const why = code === 'ESRCH' ? 'it already exited' : code === 'EPERM' ? 'not allowed (another user\'s process?)' : reason instanceof Error ? reason.message : String(reason);
			notify(`Could not stop ${port.command} (pid ${port.pid}): ${why}`, {kind: 'error'});
		}
		setTimeout(() => {
			if (mounted.current) refresh();
		}, AFTER_STOP_MS);
	};

	useKeys(
		[
			{keys: 'r', desc: 'Read the ports again', group: 'Ports', run: refresh},
			{keys: 'dd', desc: 'Stop the process (SIGTERM), after a yes', group: 'Ports', run: () => {
				if (selected) setAsking(selected);
			}},
		],
		{active: !asking},
	);

	const listening = ports ? `${ports.length} listening` : '';
	return (
		<Box flexDirection="column" flexGrow={1}>
			{asking
				? <Confirm question={`Send SIGTERM to ${asking.command} (pid ${asking.pid}, ${asking.address})?`} onAnswer={answer} />
				: <Text color={theme.muted} wrap="truncate-end">{`dd stops the highlighted process (SIGTERM) · r refreshes · / filters${listening ? ` · ${listening}` : ''}`}</Text>}
			{error ? <Text color={theme.danger}>{`Cannot list ports: ${error}`}</Text>
				: !ports ? <Text color={theme.muted}>Reading ports…</Text>
				: ports.length === 0 ? <Text color={theme.muted}>Nothing listens on TCP.</Text>
				: <Table columns={COLUMNS} rows={ports} onCursor={setSelected} active={!asking} />}
		</Box>
	);
}

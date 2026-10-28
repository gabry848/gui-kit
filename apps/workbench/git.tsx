// Git: the branch, the changed files and the diff of the highlighted one.
// Read-only: it never stages, commits or takes git's index lock.

import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {Box, Pager, Split, Text, theme, useEffect, useKeys, useRef, useState, type Column} from 'gui-kit';
import {exec, firstLine, type Result} from './exec.js';
import {describeBranch, parseStatus, type Branch, type GitEntry} from './parse.js';
import {CursorTable} from './table.js';

/** git without optional locks (status would refresh the index), pagers or ext diffs, in English. */
export function git(args: string[], cwd: string, maxBytes?: number): Promise<Result> {
	return exec(['git', '--no-optional-locks', ...args], {
		cwd,
		env: {GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0'},
		...(maxBytes ? {maxBytes} : {}),
	});
}

type Repo =
	| {state: 'loading'}
	| {state: 'none'; message: string}
	| {state: 'ready'; root: string; branch: Branch | undefined; entries: GitEntry[]};

/** The nearest folder above `cwd` with a .git; seeing it needs no read permission. */
function repoAbove(cwd: string): string | undefined {
	for (let dir = dirname(cwd); dir !== dirname(dir); dir = dirname(dir)) {
		if (existsSync(join(dir, '.git'))) return dir;
	}
	return undefined;
}

export async function loadRepo(cwd: string): Promise<Repo> {
	const top = await git(['rev-parse', '--show-toplevel'], cwd);
	if (top.code !== 0) {
		const why = firstLine(top.stderr);
		if (top.code === -1) return {state: 'none', message: `git cannot run: ${why}`};
		// The sandbox opens only the start folder, so git cannot read a repository above it and says there is none.
		const above = repoAbove(cwd);
		if (above && /not a git repository|not permitted|permission denied/i.test(why)) {
			return {state: 'none', message: `This folder is inside the repository at ${above}, which workbench may not read from here: start it in ${above}.`};
		}
		if (/not a git repository/i.test(why)) return {state: 'none', message: `Not a git repository: ${cwd}`};
		return {state: 'none', message: `git failed: ${why}`};
	}
	const root = top.stdout.trim();
	const status = await git(['status', '--porcelain=v1', '-z', '--branch'], root);
	if (status.code !== 0) return {state: 'none', message: `git status failed: ${firstLine(status.stderr)}`};
	return {state: 'ready', root, ...parseStatus(status.stdout)};
}

const DIFF_CAP = 2_000_000;
const DIFF = ['--color=always', '--no-ext-diff'];

/** A diff's text, a note when it was cut, or why git failed. */
function shown(result: Result): string {
	if (result.truncated) return `${result.stdout}\n(cut at ${DIFF_CAP / 1_000_000} MB)\n`;
	return result.stdout || (result.code === 0 || result.code === 1 ? '(no textual change)\n' : firstLine(result.stderr) + '\n');
}

/** Staged and unstaged changes of one entry, with a heading for each part. */
export async function diffFor(root: string, entry: GitEntry): Promise<string> {
	if (entry.status === '??') {
		if (entry.path.endsWith('/')) return `Untracked folder ${entry.path}: open it in the Files tab.\n`;
		// Exit 1 means "they differ", which is always the case here.
		const result = await git(['diff', '--no-index', ...DIFF, '--', '/dev/null', entry.path], root, DIFF_CAP);
		return `── Untracked ──\n${shown(result)}`;
	}
	const [index, tree] = [entry.status[0], entry.status[1]];
	const parts: string[] = [];
	if (index !== ' ' && index !== '?') {
		const paths = entry.from ? [entry.from, entry.path] : [entry.path];
		const result = await git(['diff', '--cached', '-M', ...DIFF, '--', ...paths], root, DIFF_CAP);
		parts.push(`── Staged ──\n${shown(result)}`);
	}
	if (tree !== ' ' && tree !== '?') {
		const result = await git(['diff', ...DIFF, '--', entry.path], root, DIFF_CAP);
		parts.push(`── Unstaged ──\n${shown(result)}`);
	}
	return parts.join('\n') || 'No changes.\n';
}

const COLUMNS: Column<GitEntry>[] = [
	{key: 'status', title: 'St', width: 3, format: status => status.replaceAll(' ', '·')},
	{key: 'path', title: 'Path', format: (path, entry) => (entry.from ? `${entry.from} → ${path}` : path)},
];

/** Waits a little after the cursor moves, so holding j does not start a git per row. */
const DIFF_DELAY_MS = 60;

export function GitTab({cwd}: {cwd: string}) {
	const [repo, setRepo] = useState<Repo>({state: 'loading'});
	const [selected, setSelected] = useState<GitEntry | undefined>();
	const [diff, setDiff] = useState<{entry: GitEntry; text: string} | undefined>();
	const [version, setVersion] = useState(0);
	const ticket = useRef(0);

	useEffect(() => {
		let live = true;
		void loadRepo(cwd).then(next => {
			if (live) setRepo(next);
		});
		return () => {
			live = false;
		};
	}, [cwd, version]);

	const root = repo.state === 'ready' ? repo.root : undefined;
	useEffect(() => {
		const current = ++ticket.current;
		if (!root || !selected) {
			setDiff(undefined);
			return;
		}
		const timer = setTimeout(() => {
			void diffFor(root, selected).then(text => {
				if (current === ticket.current) setDiff({entry: selected, text});
			});
		}, DIFF_DELAY_MS);
		return () => clearTimeout(timer);
	}, [root, selected, version]);

	useKeys([{keys: 'r', desc: 'Refresh status and diff', group: 'Git', run: () => setVersion(current => current + 1)}]);

	if (repo.state === 'loading') return <Text color={theme.muted}>Reading git status…</Text>;
	if (repo.state === 'none') return <Text color={theme.warning}>{repo.message}</Text>;

	const staged = repo.entries.filter(entry => entry.status[0] !== ' ' && entry.status[0] !== '?').length;
	const untracked = repo.entries.filter(entry => entry.status === '??').length;
	const summary = repo.entries.length === 0 ? 'clean' : `${repo.entries.length} changed, ${staged} staged, ${untracked} untracked`;
	return (
		<Box flexDirection="column" flexGrow={1}>
			<Text color={theme.muted} wrap="truncate-end">j/k picks a file and shows its diff · Ctrl-w w scrolls the diff · r refreshes · read-only</Text>
			<Box height={1} flexShrink={0} gap={2}>
				<Text color={theme.accent} bold>{`Branch ${describeBranch(repo.branch)}`}</Text>
				<Text color={theme.muted}>{summary}</Text>
			</Box>
			<Split
				sizes={[2, 3]}
				panes={[
					active => (repo.entries.length === 0
						? <Text color={theme.success}>Nothing to commit, working tree clean.</Text>
						: <CursorTable columns={COLUMNS} rows={repo.entries} onCursor={setSelected} active={active} />),
					active => (!diff ? <Text color={theme.muted}>{selected ? 'Loading diff…' : 'No file selected.'}</Text> : (
						<Box flexDirection="column" flexGrow={1}>
							<Box height={1} flexShrink={0} gap={2}>
								<Text color={theme.accent} bold wrap="truncate-end">{diff.entry.path}</Text>
								{selected && selected.path !== diff.entry.path ? <Text color={theme.muted}>loading…</Text> : null}
							</Box>
							<Pager key={`${diff.entry.path} ${version}`} text={diff.text} ansi active={active} />
						</Box>
					)),
				]}
			/>
		</Box>
	);
}

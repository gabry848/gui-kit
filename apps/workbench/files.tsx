// Files: the folder as a lazy tree on the left, the opened file on the right.

import {open, readdir, stat} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {Box, Image, Pager, Split, Text, Tree, theme, useEffect, useKeys, useRef, useState, type TreeNode} from 'gui-kit';
import {formatSize, imageKind, looksBinary} from './parse.js';

/** Never listed: they are huge and not what you browse. */
const SKIP = new Set(['.git', 'node_modules']);
/** Text past this is not shown. */
export const TEXT_CAP = 512 * 1024;
/** Images bigger than this are not decoded. */
const IMAGE_CAP = 20 * 1024 * 1024;

type FileNode = TreeNode & {path: string; dir: boolean};

const byName = new Intl.Collator(undefined, {numeric: true, sensitivity: 'base'});

/** One folder's entries, folders first, each group by name; children load when a folder opens. */
export async function listDir(dir: string): Promise<FileNode[]> {
	const entries = await readdir(dir, {withFileTypes: true});
	const nodes = await Promise.all(entries.filter(entry => !SKIP.has(entry.name)).map(async (entry): Promise<FileNode> => {
		const path = join(dir, entry.name);
		// A link to a folder opens like a folder.
		const isDir = entry.isDirectory() || (entry.isSymbolicLink() && await stat(path).then(info => info.isDirectory(), () => false));
		return isDir
			? {id: entry.name, label: entry.name + '/', path, dir: true, load: () => listDir(path)}
			: {id: entry.name, label: entry.name, path, dir: false};
	}));
	return nodes.sort((a, b) => Number(b.dir) - Number(a.dir) || byName.compare(a.id, b.id));
}

export type Preview =
	| {kind: 'loading'; path: string}
	| {kind: 'text'; path: string; size: number; text: string; lines: number; truncated: boolean}
	| {kind: 'image'; path: string; size: number}
	| {kind: 'note'; path: string; note: string};

/** What the preview pane shows for a file: its text, an image, or why neither. */
export async function readPreview(path: string): Promise<Preview> {
	try {
		const info = await stat(path);
		if (!info.isFile()) return {kind: 'note', path, note: 'Not a regular file'};
		const handle = await open(path, 'r');
		const head = new Uint8Array(Math.min(info.size, TEXT_CAP));
		try {
			await handle.read(head, 0, head.length, 0);
		} finally {
			await handle.close();
		}
		if (imageKind(head)) {
			return info.size <= IMAGE_CAP
				? {kind: 'image', path, size: info.size}
				: {kind: 'note', path, note: `Image too big to preview (${formatSize(info.size)})`};
		}
		if (looksBinary(head)) return {kind: 'note', path, note: `Binary file, ${formatSize(info.size)}: no preview`};
		const truncated = info.size > TEXT_CAP;
		let text = new TextDecoder().decode(head);
		// Cut at the last full line rather than in the middle of a character.
		if (truncated && text.includes('\n')) text = text.slice(0, text.lastIndexOf('\n') + 1);
		const lines = text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
		return {kind: 'text', path, size: info.size, text, lines, truncated};
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		const why = code === 'EPERM' || code === 'EACCES' ? 'permission denied' : code === 'ENOENT' ? 'file not found' : error instanceof Error ? error.message : String(error);
		return {kind: 'note', path, note: `Cannot read: ${why}`};
	}
}

function PreviewPane({preview, cwd, active}: {preview: Preview | undefined; cwd: string; active: boolean}) {
	if (!preview) {
		return <Text color={theme.muted}>Open a file with Enter to see it here.</Text>;
	}
	const name = relative(cwd, preview.path) || preview.path;
	const facts = preview.kind === 'text'
		? [formatSize(preview.size), `${preview.lines} ${preview.lines === 1 ? 'line' : 'lines'}`, ...(preview.truncated ? [`first ${formatSize(TEXT_CAP)} shown`] : [])]
		: preview.kind === 'image' ? [formatSize(preview.size), 'image'] : [];
	return (
		<Box flexDirection="column" flexGrow={1}>
			<Box height={1} flexShrink={0} gap={2}>
				<Text color={theme.accent} bold wrap="truncate-end">{name}</Text>
				<Text color={theme.muted}>{facts.join(' · ')}</Text>
			</Box>
			{preview.kind === 'loading' ? <Text color={theme.muted}>Loading…</Text>
				: preview.kind === 'note' ? <Text color={theme.warning}>{preview.note}</Text>
				: preview.kind === 'image' ? <Image src={preview.path} />
				: <Pager key={preview.path} text={preview.text} active={active} />}
		</Box>
	);
}

export function FilesTab({cwd}: {cwd: string}) {
	const [nodes, setNodes] = useState<FileNode[] | undefined>();
	const [error, setError] = useState<string | undefined>();
	const [preview, setPreview] = useState<Preview | undefined>();
	// Bumped by r: a new Tree, with its folders closed and read again.
	const [version, setVersion] = useState(0);
	const opening = useRef(0);

	useEffect(() => {
		let live = true;
		listDir(cwd).then(
			list => {
				if (!live) return;
				setNodes(list);
				setError(undefined);
			},
			(reason: unknown) => {
				if (live) setError(reason instanceof Error ? reason.message : String(reason));
			},
		);
		return () => {
			live = false;
		};
	}, [cwd, version]);

	const openFile = (node: TreeNode) => {
		const {path} = node as FileNode;
		const ticket = ++opening.current;
		setPreview({kind: 'loading', path});
		void readPreview(path).then(result => {
			if (ticket === opening.current) setPreview(result);
		});
	};

	useKeys([{keys: 'r', desc: 'Read the folder again', group: 'Files', run: () => setVersion(current => current + 1)}]);

	return (
		<Box flexDirection="column" flexGrow={1}>
			<Text color={theme.muted} wrap="truncate-end">Enter opens a file · l/h open and close folders · / filters · Ctrl-w w switches pane · r reloads</Text>
			<Split
				sizes={[2, 3]}
				panes={[
					active => (error ? <Text color={theme.danger}>{`Cannot list ${cwd}: ${error}`}</Text>
						: !nodes ? <Text color={theme.muted}>Loading…</Text>
						: nodes.length === 0 ? <Text color={theme.muted}>This folder is empty.</Text>
						: <Tree key={version} nodes={nodes} onOpen={openFile} active={active} />),
					active => <PreviewPane preview={preview} cwd={cwd} active={active} />,
				]}
			/>
		</Box>
	);
}

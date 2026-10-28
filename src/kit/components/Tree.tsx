import {useEffect, useRef, useState} from 'react';
import {Box, Text, useBoxMetrics, type DOMElement} from 'ink';
import {useKeys, useKit, useMouse} from '../context.js';
import {absolutePosition} from '../layout.js';
import {theme} from '../theme.js';

export type TreeNode = {
	/** Unique among its siblings. */
	id: string;
	label: string;
	children?: TreeNode[];
	/** Loads the children the first time the node opens; a node with neither is a leaf. */
	load?: () => Promise<TreeNode[]>;
};

type Props = {
	nodes: TreeNode[];
	/** Enter or a second click on a leaf. */
	onOpen?: (node: TreeNode) => void;
	/**
	 * The highlighted node each time it changes, as List's onCursor: first on
	 * mount, undefined when nothing is highlighted or the tree unmounts. A
	 * node counts as the same while its path of ids stays the same.
	 */
	onCursor?: (node: TreeNode | undefined) => void;
	active?: boolean;
	/** Rows to show. By default the tree fills the space its parent gives it. */
	height?: number;
};

type Row = {node: TreeNode; key: string; depth: number; parent: string | undefined; branch: boolean; open: boolean; loading: boolean};

type Shape = {expanded: Set<string>; loaded: Map<string, TreeNode[]>; loading: Set<string>; query: string};

// A row's key is the path of ids from the root, so equal ids in different branches stay apart.
const SEP = '\u001F';

/**
 * The rows on screen. With a query, the loaded nodes whose label matches
 * show up with their ancestors, open or not.
 */
function flatten(nodes: TreeNode[], shape: Shape, depth = 0, parent?: string, out: Row[] = []): Row[] {
	const query = shape.query.toLowerCase();
	for (const node of nodes) {
		const key = parent === undefined ? node.id : parent + SEP + node.id;
		const children = node.children ?? shape.loaded.get(key);
		const branch = node.children !== undefined || node.load !== undefined;
		const row: Row = {node, key, depth, parent, branch, open: false, loading: shape.loading.has(key)};
		const start = out.length;
		out.push(row);
		if (query) {
			if (children) flatten(children, shape, depth + 1, key, out);
			row.open = out.length > start + 1;
			if (!row.open && !node.label.toLowerCase().includes(query)) out.pop();
		} else if (branch && shape.expanded.has(key)) {
			row.open = true;
			if (children) flatten(children, shape, depth + 1, key, out);
		}
	}
	return out;
}

/**
 * An expandable tree driven by Vim keys: j/k move, l opens a branch or goes
 * into it, h closes it or goes to the parent, Enter opens a leaf, zR and zM
 * open and close everything, `/` filters. Children can load lazily.
 */
export function Tree({nodes, onOpen, onCursor, active = true, height: fixedHeight}: Props) {
	const ref = useRef<DOMElement>(null);
	const {height: measured} = useBoxMetrics(ref);
	const {keymap} = useKit();
	const [expanded, setExpanded] = useState(() => new Set<string>());
	const [loaded, setLoaded] = useState(() => new Map<string, TreeNode[]>());
	const [loading, setLoading] = useState(() => new Set<string>());
	const [query, setQuery] = useState('');
	const [cursor, setCursor] = useState<string | undefined>();
	const offset = useRef(0);
	// Loads in flight, read at once: `loading` is state, so two expands before a render would both see it empty.
	const inflight = useRef(new Set<string>());
	const mounted = useRef(true);
	useEffect(() => () => {
		mounted.current = false;
	}, []);

	const rows = flatten(nodes, {expanded, loaded, loading, query});
	const height = fixedHeight ?? (measured > 1 ? measured : Math.min(Math.max(rows.length, 1), 10));
	const last = Math.max(0, rows.length - 1);

	// The cursor follows its node; when a collapse hides it, it lands on the nearest visible ancestor.
	let index = rows.findIndex(row => row.key === cursor);
	for (let key = cursor ?? ''; index === -1 && key.includes(SEP);) {
		key = key.slice(0, key.lastIndexOf(SEP));
		index = rows.findIndex(row => row.key === key);
	}
	index = Math.max(0, index);
	const row = rows[index];
	// Scroll just enough to keep the cursor in view, without a gap below the last row.
	offset.current = Math.max(0, Math.min(offset.current, index, rows.length - height));
	if (index >= offset.current + height) offset.current = index - height + 1;

	const moveTo = (target: number) => setCursor(rows[Math.min(last, Math.max(0, target))]?.key);

	// By path, not identity: nodes built anew on each render are still the same node.
	const reported = useRef<string | undefined>(undefined);
	const latestCursor = useRef(onCursor);
	latestCursor.current = onCursor;
	useEffect(() => {
		if (row?.key === reported.current) return;
		reported.current = row?.key;
		latestCursor.current?.(row?.node);
	});
	useEffect(() => () => {
		if (reported.current !== undefined) latestCursor.current?.(undefined);
	}, []);

	const expand = (target: Row) => {
		if (!target.branch) return;
		setExpanded(current => new Set(current).add(target.key));
		const {node, key} = target;
		if (node.children !== undefined || !node.load || loaded.has(key) || inflight.current.has(key)) return;
		inflight.current.add(key);
		setLoading(current => new Set(current).add(key));
		node.load().then(
			children => {
				if (mounted.current) setLoaded(current => new Map(current).set(key, children));
			},
			(error: unknown) => {
				if (!mounted.current) return;
				keymap.flash(`Could not load ${node.label}: ${error instanceof Error ? error.message : String(error)}`);
				setExpanded(current => {
					const next = new Set(current);
					next.delete(key);
					return next;
				});
			},
		).finally(() => {
			inflight.current.delete(key);
			if (!mounted.current) return;
			setLoading(current => {
				const next = new Set(current);
				next.delete(key);
				return next;
			});
		});
	};
	const collapse = (key: string) => setExpanded(current => {
		const next = new Set(current);
		next.delete(key);
		return next;
	});

	const right = () => {
		if (!row) return;
		if (!row.open) expand(row);
		else if (rows[index + 1]?.parent === row.key) moveTo(index + 1);
	};
	const left = () => {
		if (!row) return;
		if (row.open && !query) collapse(row.key);
		else if (row.parent !== undefined) setCursor(row.parent);
	};
	const activate = () => {
		if (!row) return;
		if (!row.branch) onOpen?.(row.node);
		else if (expanded.has(row.key)) collapse(row.key);
		else expand(row);
	};
	// Opens every branch whose children are already known; it does not start loaders.
	const expandAll = () => {
		const keys = new Set<string>();
		const walk = (list: TreeNode[], parent?: string) => {
			for (const node of list) {
				const key = parent === undefined ? node.id : parent + SEP + node.id;
				const children = node.children ?? loaded.get(key);
				if (children) {
					keys.add(key);
					walk(children, key);
				}
			}
		};
		walk(nodes);
		setExpanded(keys);
	};

	// Like List: `/` filters as you type, Enter keeps the filter, Esc drops it.
	const search = useRef<(value: string, live: boolean) => void>(undefined);
	search.current = (value, live) => {
		setQuery(value);
		if (value) {
			const lower = value.toLowerCase();
			const first = flatten(nodes, {expanded, loaded, loading, query: value}).find(item => item.node.label.toLowerCase().includes(lower));
			if (first) setCursor(first.key);
		} else if (cursor) {
			// Back to the whole tree, still on the node found: open its ancestors.
			setExpanded(current => {
				const next = new Set(current);
				for (let key = cursor; key.includes(SEP);) {
					key = key.slice(0, key.lastIndexOf(SEP));
					next.add(key);
				}
				return next;
			});
		}
		if (!live) keymap.flash(value ? `Filter: ${value}` : '');
	};
	useEffect(() => {
		if (!active) {
			return;
		}
		return keymap.onSearch((value, live) => search.current?.(value, live));
	}, [keymap, active]);

	useKeys(
		[
			{keys: 'j', desc: 'Down', group: 'Tree', run: count => moveTo(index + count)},
			{keys: 'k', desc: 'Up', group: 'Tree', run: count => moveTo(index - count)},
			{keys: '<Down>', desc: 'Down', group: 'hidden', run: count => moveTo(index + count)},
			{keys: '<Up>', desc: 'Up', group: 'hidden', run: count => moveTo(index - count)},
			{keys: 'l', desc: 'Expand, or go into', group: 'Tree', run: right},
			{keys: 'h', desc: 'Collapse, or go to the parent', group: 'Tree', run: left},
			{keys: '<Right>', desc: 'Expand, or go into', group: 'hidden', run: right},
			{keys: '<Left>', desc: 'Collapse, or go to the parent', group: 'hidden', run: left},
			{keys: '<CR>', desc: 'Open a leaf, toggle a branch', group: 'Tree', run: activate},
			{keys: 'zR', desc: 'Expand all loaded', group: 'Tree', run: expandAll},
			{keys: 'zM', desc: 'Collapse all', group: 'Tree', run: () => setExpanded(new Set())},
			{keys: 'gg', desc: 'First', group: 'Tree', run: () => moveTo(0)},
			{keys: 'G', desc: 'Last', group: 'Tree', run: () => moveTo(last)},
			{keys: '/', desc: 'Filter', group: 'Tree', run: () => keymap.openCmdline('/')},
		],
		{active},
	);

	useMouse(event => {
		const node = ref.current;
		if (!node) {
			return;
		}
		const corner = absolutePosition(node);
		const line = event.y - corner.y;
		if (line < 0 || line >= height || event.x < corner.x || event.x >= corner.x + (node.yogaNode?.getComputedWidth() ?? 0)) {
			return;
		}
		if (event.kind === 'wheel') {
			moveTo(index + (event.wheel === 'down' ? 3 : -3));
		} else if (event.kind === 'down' && event.button === 'left' && offset.current + line <= last) {
			if (offset.current + line === index) activate();
			else moveTo(offset.current + line);
		}
	}, active);

	const start = offset.current;
	return (
		<Box ref={ref} flexDirection="column" flexGrow={1} overflow="hidden" {...(fixedHeight ? {height: fixedHeight, flexGrow: 0} : {})}>
			{rows.slice(start, start + height).map((item, position) => {
				const selected = start + position === index;
				return (
					<Box key={item.key} height={1} {...(selected ? {backgroundColor: theme.selection} : {})}>
						<Text color={selected ? theme.accent : theme.muted}>{selected ? '▌' : ' '}</Text>
						<Text color={theme.muted}>{'  '.repeat(item.depth) + (item.branch ? (item.open ? '▾ ' : '▸ ') : '  ')}</Text>
						<Text color={theme.text} bold={selected} wrap="truncate-end">{item.node.label}</Text>
						{item.loading ? <Text color={theme.muted}> loading…</Text> : null}
					</Box>
				);
			})}
			{rows.length === 0 ? <Text color={theme.muted}> No results</Text> : null}
		</Box>
	);
}

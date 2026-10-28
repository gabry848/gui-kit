import {expect, test} from 'bun:test';
import {List, Modal, Shell, Split, Tabs, Text, Tree, useEffect, useState, type TreeNode} from '../src/kit/index.js';
import {headless} from '../src/kit/testing.js';

const mounts: string[] = [];

function Probe({name}: {name: string}) {
	useEffect(() => {
		mounts.push(`+${name}`);
		return () => {
			mounts.push(`-${name}`);
		};
	}, []);
	return <Text>{`content ${name}`}</Text>;
}

const TABS = [
	{id: 'a', title: 'Alpha', content: <Probe name="A" />},
	{id: 'b', title: 'Beta', content: <Probe name="B" />},
	{id: 'c', title: 'Gamma', content: <Probe name="C" />},
];

test('tabs: gt, gT, a count picks the tab, only the open tab is mounted', async () => {
	mounts.length = 0;
	const app = await headless(<Shell title="t"><Tabs tabs={TABS} /></Shell>, {cols: 60, rows: 8});
	expect(app.lines()[0]).toBe(' 1 Alpha   2 Beta   3 Gamma');
	expect(app.screen()).toContain('content A');
	await app.press('gt');
	expect(app.screen()).toContain('content B');
	expect(app.screen()).not.toContain('content A');
	await app.press('gT');
	await app.press('gT');
	expect(app.screen()).toContain('content C');
	await app.press('2gt');
	expect(app.screen()).toContain('content B');
	await app.press('1gt');
	expect(app.screen()).toContain('content A');
	await app.press('9gt');
	expect(app.screen()).toContain('content A');
	// The same component in two tabs is still remounted.
	expect(mounts).toEqual(['+A', '-A', '+B', '-B', '+A', '-A', '+C', '-C', '+B', '-B', '+A']);
	await app.exit();
});

test('tabs: a click on a title opens it; controlled through selected and onChange', async () => {
	const changes: string[] = [];
	function Controlled() {
		const [tab, setTab] = useState('b');
		return (
			<Shell title="t">
				<Tabs tabs={TABS} selected={tab} onChange={id => {
					changes.push(id);
					setTab(id);
				}} />
			</Shell>
		);
	}
	const app = await headless(<Controlled />, {cols: 60, rows: 8});
	expect(app.screen()).toContain('content B');
	// " 1 Alpha " and a space, " 2 Beta " and a space: Gamma starts at column 19.
	await app.mouse('down', 21, 0);
	expect(app.screen()).toContain('content C');
	await app.press('gt');
	expect(app.screen()).toContain('content A');
	expect(changes).toEqual(['c', 'a']);
	await app.exit();
});

const opened: string[] = [];

function lazy(): Promise<TreeNode[]> {
	return new Promise(resolve => setTimeout(() => resolve([{id: 'x', label: 'loaded-x'}, {id: 'y', label: 'loaded-y'}]), 80));
}

const TREE: TreeNode[] = [
	{id: 'src', label: 'src', children: [
		{id: 'kit', label: 'kit', children: [{id: 'list', label: 'List.tsx'}, {id: 'tree', label: 'Tree.tsx'}]},
		{id: 'main', label: 'main.ts'},
	]},
	{id: 'remote', label: 'remote', load: lazy},
	{id: 'readme', label: 'README.md'},
];

function TreeApp({nodes = TREE, height}: {nodes?: TreeNode[]; height?: number}) {
	return <Shell title="tree"><Tree nodes={nodes} onOpen={node => opened.push(node.label)} {...(height ? {height} : {})} /></Shell>;
}

test('tree: l and h expand, go in, collapse and go up; Enter opens a leaf', async () => {
	opened.length = 0;
	const app = await headless(<TreeApp />, {cols: 50, rows: 12});
	expect(app.lines().slice(0, 3)).toEqual(['▌▸ src', ' ▸ remote', '   README.md']);
	await app.press('l');
	expect(app.lines()[1]).toBe('   ▸ kit');
	await app.press('ll');
	expect(app.lines()[1]).toBe('▌  ▾ kit');
	expect(app.lines()[2]).toBe('       List.tsx');
	await app.press('j<CR>');
	expect(opened).toEqual(['List.tsx']);
	await app.press('h');
	expect(app.lines()[1]).toBe('▌  ▾ kit');
	await app.press('hh');
	expect(app.lines()[0]).toBe('▌▾ src');
	expect(app.screen()).not.toContain('List.tsx');
	await app.press('<CR>');
	expect(app.lines().slice(0, 3)).toEqual(['▌▸ src', ' ▸ remote', '   README.md']);
	await app.exit();
});

test('tree: lazy children show a loading marker, zR opens what is loaded, zM closes all', async () => {
	const app = await headless(<TreeApp />, {cols: 50, rows: 12});
	await app.press('jl');
	expect(app.lines()[1]).toBe('▌▾ remote loading…');
	await app.settle(120);
	expect(app.lines().slice(1, 4)).toEqual(['▌▾ remote', '     loaded-x', '     loaded-y']);
	await app.press('zM');
	expect(app.screen()).not.toContain('loaded-x');
	expect(app.lines()[1]).toBe('▌▸ remote');
	await app.press('zR');
	expect(app.screen()).toContain('List.tsx');
	expect(app.screen()).toContain('loaded-y');
	// The cursor stays on its node while rows open above it.
	expect(app.lines()[5]).toBe('▌▾ remote');
	await app.press('G');
	expect(app.lines()[8]).toBe('▌  README.md');
	await app.press('gg3j');
	expect(app.lines()[3]).toBe('▌      Tree.tsx');
	await app.exit();
});

test('tree: a failing loader collapses the node and says why', async () => {
	const nodes: TreeNode[] = [{id: 'bad', label: 'bad', load: () => Promise.reject(new Error('offline'))}];
	const app = await headless(<TreeApp nodes={nodes} />, {cols: 60, rows: 6});
	await app.press('l');
	await app.settle(40);
	expect(app.lines()[0]).toBe('▌▸ bad');
	expect(app.screen()).toContain('Could not load bad: offline');
	await app.exit();
});

test('tree: / filters to the matches and their ancestors, clearing it keeps the node', async () => {
	const app = await headless(<TreeApp />, {cols: 50, rows: 12});
	await app.press('/tree<CR>');
	expect(app.lines().slice(0, 4)).toEqual([' ▾ src', '   ▾ kit', '▌      Tree.tsx', '']);
	expect(app.screen()).toContain('Filter: tree');
	await app.press('/<CR>');
	expect(app.lines().slice(0, 5)).toEqual([' ▾ src', '   ▾ kit', '       List.tsx', '▌      Tree.tsx', '     main.ts']);
	await app.press('/nothing<CR>');
	expect(app.screen()).toContain('No results');
	await app.exit();
});

test('tree: scrolls to keep the cursor visible; click selects, a second click toggles, wheel moves', async () => {
	const many: TreeNode[] = Array.from({length: 30}, (_, index) => ({id: String(index), label: `node-${index + 1}`}));
	many[0] = {id: 'top', label: 'folder', children: [{id: 'leaf', label: 'leaf'}]};
	const app = await headless(<TreeApp nodes={many} />, {cols: 40, rows: 6});
	await app.press('G');
	expect(app.lines()[4]).toBe('▌  node-30');
	expect(app.screen()).not.toContain('folder');
	await app.press('gg');
	expect(app.lines()[0]).toBe('▌▸ folder');
	await app.mouse('down', 5, 2);
	expect(app.lines()[2]).toBe('▌  node-3');
	await app.mouse('down', 5, 0);
	await app.mouse('down', 5, 0);
	expect(app.lines()[1]).toBe('     leaf');
	await app.mouse('wheelDown', 5, 1);
	expect(app.lines()[3]).toBe('▌  node-3');
	await app.exit();
});

test('tree and tabs get no keys or clicks under a Modal', async () => {
	function Covered() {
		const [open, setOpen] = useState(true);
		return (
			<Shell title="m">
				<Tabs tabs={[{id: 'tree', title: 'Tree', content: <Tree nodes={TREE} />}, {id: 'other', title: 'Other', content: <Text>other</Text>}]} />
				{open ? <Modal title="Busy" onClose={() => setOpen(false)}><Text>wait</Text></Modal> : null}
			</Shell>
		);
	}
	const app = await headless(<Covered />, {cols: 60, rows: 14});
	await app.press('jgt');
	await app.mouse('down', 13, 0);
	expect(app.lines()[1]).toBe('▌▸ src');
	expect(app.screen()).not.toContain('other');
	await app.press('<Esc>j');
	expect(app.lines()[2]).toBe('▌▸ remote');
	await app.exit();
});

function Panes({direction = 'row', sizes, trees = false}: {direction?: 'row' | 'column'; sizes?: number[]; trees?: boolean}) {
	const items = ['one', 'two', 'three'];
	const pane = (name: string) => (active: boolean) => (trees
		? <Tree nodes={items.map(item => ({id: item, label: `${name}-${item}`}))} active={active} />
		: <List items={items.map(item => `${name}-${item}`)} text={item => item} render={item => <Text>{item}</Text>} active={active} />);
	return <Shell title="s"><Split panes={[pane('L'), pane('R')]} direction={direction} {...(sizes ? {sizes} : {})} /></Shell>;
}

test('split: Ctrl-w keys move the focus and only the focused pane gets keys', async () => {
	const app = await headless(<Panes />, {cols: 60, rows: 8});
	await app.press('j');
	expect(app.screen()).toContain('▌L-two');
	expect(app.screen()).toContain('▌R-one');
	await app.press('<C-w>lj');
	expect(app.screen()).toContain('▌L-two');
	expect(app.screen()).toContain('▌R-two');
	await app.press('<C-w>hj');
	expect(app.screen()).toContain('▌L-three');
	await app.press('<C-w>wk');
	expect(app.screen()).toContain('▌R-one');
	await app.press('<C-w><C-w>k');
	expect(app.screen()).toContain('▌L-two');
	// In a row, Ctrl-w j has no pane below.
	await app.press('<C-w>jk');
	expect(app.screen()).toContain('▌L-one');
	await app.exit();
});

test('split: a click focuses the pane under it; column direction and sizes', async () => {
	// Trees, not Lists: a List also takes clicks to the right of its own box.
	const app = await headless(<Panes sizes={[1, 2]} trees />, {cols: 60, rows: 8});
	// Borders count in the ratio: 21 and 39 columns out of 60.
	expect(app.lines()[0]!.indexOf('╮╭')).toBe(20);
	await app.mouse('down', 40, 3);
	await app.press('j');
	expect(app.screen()).toContain('▌  R-two');
	expect(app.screen()).toContain('▌  L-one');
	await app.exit();

	const stacked = await headless(<Panes direction="column" />, {cols: 40, rows: 15});
	await stacked.press('<C-w>jj');
	expect(stacked.screen()).toContain('▌R-two');
	await stacked.press('<C-w>kj');
	expect(stacked.screen()).toContain('▌L-two');
	await stacked.exit();
});

test('help lists the new groups', async () => {
	const app = await headless(<Shell title="h"><Tabs tabs={[{id: 't', title: 'T', content: <Tree nodes={TREE} />}]} /></Shell>, {cols: 100, rows: 40});
	await app.press('?');
	expect(app.screen()).toContain('Tabs');
	expect(app.screen()).toContain('Expand all loaded');
	expect(app.screen()).toContain('Next tab, or tab N after a count');
	await app.exit();
});

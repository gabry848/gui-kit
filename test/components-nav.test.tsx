import {expect, test} from 'bun:test';
import {createContext, Form, List, Modal, Shell, Split, Tabs, Text, Tree, useContext, useEffect, useKeys, useState, type TreeNode} from '../src/kit/index.js';
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

test('tabs: a count larger than the number of tabs wraps around, as in Vim', async () => {
	const app = await headless(<Shell title="t"><Tabs tabs={TABS} /></Shell>, {cols: 60, rows: 8});
	await app.press('4gT');
	expect(app.screen()).toContain('content C');
	await app.press('1gt5gT');
	expect(app.screen()).toContain('content B');
	await app.press('7gT');
	expect(app.screen()).toContain('content A');
	await app.exit();
});

test('split: focus and onFocusChange control the focused pane', async () => {
	const changes: number[] = [];
	function Controlled({follow}: {follow: boolean}) {
		const [focus, setFocus] = useState(1);
		useKeys([{keys: 'x', desc: 'Back to the first pane', run: () => setFocus(0)}]);
		const pane = (name: string) => (active: boolean) => <List items={['one', 'two']} text={item => item} render={item => <Text>{`${name}-${item}`}</Text>} active={active} />;
		return (
			<Shell title="s">
				<Split panes={[pane('L'), pane('R')]} focus={focus} onFocusChange={index => {
					changes.push(index);
					if (follow) setFocus(index);
				}} />
			</Shell>
		);
	}
	const app = await headless(<Controlled follow />, {cols: 60, rows: 8});
	// The second pane starts focused, so j moves its list.
	await app.press('j');
	expect(app.screen()).toContain('▌R-two');
	expect(app.screen()).toContain('▌L-one');
	await app.press('<C-w>hj');
	expect(app.screen()).toContain('▌L-two');
	await app.mouse('down', 40, 3);
	// A click in the pane that already has the focus is not a change.
	await app.mouse('down', 40, 3);
	expect(changes).toEqual([0, 1]);
	await app.press('xk');
	expect(app.screen()).toContain('▌L-one');
	await app.exit();

	// A parent that does not follow keeps the focus where it says.
	changes.length = 0;
	const fixed = await headless(<Controlled follow={false} />, {cols: 60, rows: 8});
	await fixed.press('<C-w>hj');
	expect(changes).toEqual([0]);
	expect(fixed.screen()).toContain('▌R-two');
	expect(fixed.screen()).toContain('▌L-one');
	await fixed.exit();
});

const Where = createContext('outside');

function DetailsPane({active}: {active: boolean}) {
	const [open, setOpen] = useState<string | undefined>();
	const where = useContext(Where);
	const [ticked, setTicked] = useState<boolean | undefined>();
	return (
		<>
			<List items={['alpha', 'beta']} text={item => item} render={item => <Text>{item}</Text>} active={active && !open} onOpen={setOpen} />
			{open ? (
				<Modal title="Details" onClose={() => setOpen(undefined)}>
					<Text>{`Opened ${open} in ${where}`}</Text>
					<Form fields={[{name: 'keep', label: 'Keep', type: 'checkbox'}]} onSubmit={values => setTicked(Boolean(values['keep']))} />
				</Modal>
			) : null}
			{ticked === undefined ? null : <Text>{`submitted ${ticked}`}</Text>}
		</>
	);
}

test('a Modal opened in a Split pane is drawn whole over the screen and keeps its contexts', async () => {
	const app = await headless(
		<Shell title="m">
			<Where.Provider value="the right pane">
				<Split panes={[active => <List items={['x', 'y']} text={item => item} render={item => <Text>{item}</Text>} active={active} />, active => <DetailsPane active={active} />]} />
			</Where.Provider>
		</Shell>,
		{cols: 80, rows: 18},
	);
	await app.press('<C-w>l<CR>');
	const lines = app.lines();
	const title = lines.findIndex(line => line.includes('Details'));
	const text = lines.find(line => line.includes('Opened'))!;
	expect(text).toContain('Opened alpha in the right pane');
	// Centered on the 80 columns of the screen, not in the right pane, and not cut by it.
	const left = text.indexOf('│');
	const right = text.lastIndexOf('│');
	expect(left + right).toBeGreaterThanOrEqual(78);
	expect(left + right).toBeLessThanOrEqual(80);
	expect(left).toBeLessThan(40);
	expect(lines[title - 2]).toContain('╭');
	// It takes the keys: x ticks the box of the Form in it, the list below stays.
	await app.press('x');
	expect(app.screen()).toContain('[x]');
	expect(app.screen()).toContain('▌alpha');
	// Clicks reach the Form inside, wherever the Modal is drawn: select Submit, then press it.
	const submit = app.lines().findIndex(line => line.includes(' Submit '));
	await app.mouse('down', app.lines()[submit]!.indexOf('Submit'), submit);
	await app.mouse('down', app.lines()[submit]!.indexOf('Submit'), submit);
	expect(app.screen()).toContain('submitted true');
	await app.press('<Esc>');
	expect(app.screen()).not.toContain('Details');
	await app.press('j');
	expect(app.screen()).toContain('▌beta');
	await app.exit();
});

test('tree: onCursor reports the highlighted node by path, not by object', async () => {
	const seen: (string | undefined)[] = [];
	let renders = 0;
	function Reporting() {
		const [shown, setShown] = useState(true);
		const [, setLast] = useState<TreeNode | undefined>();
		renders++;
		// Built again on every render: the same ids are still the same nodes.
		const nodes: TreeNode[] = [{id: 'a', label: 'a', children: [{id: 'b', label: 'b'}]}, {id: 'c', label: 'c'}];
		useKeys([{keys: 'u', desc: 'Unmount', run: () => setShown(false)}]);
		return (
			<Shell title="t">
				{shown ? <Tree nodes={nodes} onCursor={node => {
					seen.push(node?.label);
					setLast(node);
				}} /> : <Text>gone</Text>}
			</Shell>
		);
	}
	const app = await headless(<Reporting />, {cols: 40, rows: 8});
	expect(seen).toEqual(['a']);
	await app.press('lj');
	expect(seen).toEqual(['a', 'b']);
	// Closing the parent moves the cursor up to it.
	await app.press('hh');
	expect(seen).toEqual(['a', 'b', 'a']);
	await app.press('/c<CR>');
	expect(seen).toEqual(['a', 'b', 'a', 'c']);
	await app.press('/zzz<CR>');
	expect(seen).toEqual(['a', 'b', 'a', 'c', undefined]);
	await app.press('/<CR>');
	expect(seen.at(-1)).toBe('c');
	const before = renders;
	await app.settle(100);
	expect(renders).toBe(before);
	await app.press('u');
	expect(seen.at(-1)).toBeUndefined();
	await app.exit();
});

test('tree: two clicks in one read open a lazy branch and close it again, loading once', async () => {
	let calls = 0;
	const nodes: TreeNode[] = [{id: 'remote', label: 'remote', load: () => {
		calls++;
		return lazy();
	}}];
	const app = await headless(<TreeApp nodes={nodes} />, {cols: 40, rows: 6});
	const click = '\u001B[<0;3;1M\u001B[<0;3;1m';
	await app.type(click + click);
	await app.settle(150);
	expect(calls).toBe(1);
	expect(app.lines()[0]).toBe('▌▸ remote');
	await app.exit();
});

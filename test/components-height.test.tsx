import {afterEach, beforeEach, expect, test} from 'bun:test';
import type {ReactNode} from 'react';
import {Box, List, Pager, Shell, Split, Table, Tabs, Text, Tree, useKeys, useState, type TreeNode} from '../src/kit/index.js';
import {headless} from '../src/kit/testing.js';

// React reports an endless render loop with console.error ("Maximum update depth exceeded").
let errors: string[] = [];
const originalError = console.error;
beforeEach(() => {
	errors = [];
	console.error = (...args: unknown[]) => {
		errors.push(args.map(String).join(' '));
	};
});
afterEach(() => {
	console.error = originalError;
});

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu'];
const NODES: TreeNode[] = WORDS.map(word => ({id: word, label: `${word}.md`}));
const TEXT = WORDS.map((word, index) => `line ${index + 1} ${word}`);

let renders = 0;
const word = (item: string) => {
	renders++;
	return <Text>{item}</Text>;
};
const list = (active = true) => <List items={WORDS} text={item => item} render={word} active={active} />;

/** Draws `node`, checks that it settles (no loop, no more renders), and gives the screen. */
async function settled(node: ReactNode, cols: number, rows: number) {
	renders = 0;
	const app = await headless(<Shell title="h">{node}</Shell>, {cols, rows});
	await app.settle(100);
	const frame = app.screen();
	const before = renders;
	await app.settle(150);
	expect(errors.filter(error => error.includes('Maximum update depth'))).toEqual([]);
	expect(renders).toBe(before);
	expect(app.screen()).toBe(frame);
	return app;
}

test('list, tree and pager with exactly one row of room: no render loop, the cursor row and the status line show', async () => {
	const app = await settled(list(), 40, 2);
	expect(app.lines()[0]).toBe('▌alpha');
	expect(app.lines()[1]).toStartWith(' NORMAL  h');
	await app.press('3j');
	expect(app.lines()[0]).toBe('▌delta');
	await app.exit();

	const tree = await settled(<Tree nodes={NODES} />, 40, 2);
	expect(tree.lines()[0]).toBe('▌  alpha.md');
	expect(tree.lines()[1]).toStartWith(' NORMAL  h');
	await tree.press('j');
	expect(tree.lines()[0]).toBe('▌  beta.md');
	await tree.exit();

	// One row: the text, with no room left for the position line.
	const pager = await settled(<Pager text={TEXT} />, 40, 2);
	expect(pager.lines()[0]).toBe('line 1 alpha');
	expect(pager.lines()[1]).toStartWith(' NORMAL  h');
	await pager.press('2j');
	expect(pager.lines()[0]).toBe('line 3 gamma');
	await pager.exit();
});

test('table with one or two rows of room: no render loop, the header, then the cursor row, and the status line', async () => {
	type Row = {name: string};
	const table = <Table<Row> columns={[{key: 'name', title: 'Name'}]} rows={WORDS.map(name => ({name}))} />;
	const one = await settled(table, 40, 2);
	expect(one.lines()[0]).toStartWith(' Name');
	expect(one.lines()[1]).toStartWith(' NORMAL  h');
	await one.exit();

	const two = await settled(table, 40, 3);
	expect(two.lines()[0]).toStartWith(' Name');
	expect(two.lines()[1]).toStartWith('▌alpha');
	expect(two.lines()[2]).toStartWith(' NORMAL  h');
	await two.exit();
});

test('a one-row Split pane shows the cursor row and follows it', async () => {
	for (const rows of [8, 9]) {
		// Column direction, sizes [1, 4]: the first pane has one row inside its border.
		const app = await settled(<Split direction="column" sizes={[1, 4]} panes={[active => list(active), () => <Text>below</Text>]} />, 40, rows);
		expect(app.lines()[1]).toStartWith('│▌alpha');
		await app.press('4j');
		expect(app.lines()[1]).toStartWith('│▌epsilon');
		await app.exit();
	}
});

test('tabs over a split of a tree and a pager in a short terminal: no render loop, the tree shows its cursor', async () => {
	const files = (
		<Tabs tabs={[{id: 'files', title: 'Files', content: (
			<Split panes={[active => <Tree nodes={NODES} active={active} />, active => <Pager text={TEXT} active={active} />]} />
		)}]} />
	);
	// Tab titles, the panes' borders around one row, the status line.
	const app = await settled(files, 60, 5);
	expect(app.lines()[2]).toStartWith('│▌  alpha.md');
	expect(app.lines()[2]).toContain('│line 1 alpha');
	expect(app.lines()[4]).toStartWith(' NORMAL  h');
	await app.press('j');
	expect(app.lines()[2]).toStartWith('│▌  beta.md');
	await app.exit();
	// No row inside the borders at all.
	const none = await settled(files, 60, 4);
	expect(none.lines()[3]).toStartWith(' NORMAL  h');
	await none.exit();
});

test('a list in a box sized by its content grows with its items, up to 10 rows', async () => {
	function Growing() {
		const [count, setCount] = useState(2);
		useKeys([{keys: 'A', desc: 'More', run: () => setCount(current => current + 3)}]);
		return (
			<Box flexDirection="column">
				<List items={WORDS.slice(0, count)} text={item => item} render={item => <Text>{item}</Text>} />
				<Text>under</Text>
			</Box>
		);
	}
	const app = await settled(<Growing />, 40, 20);
	expect(app.lines().slice(0, 3)).toEqual(['▌alpha', ' beta', 'under']);
	await app.press('A');
	expect(app.lines().slice(0, 6)).toEqual(['▌alpha', ' beta', ' gamma', ' delta', ' epsilon', 'under']);
	await app.press('AAA');
	expect(app.lines()[9]).toBe(' kappa');
	expect(app.lines()[10]).toBe('under');
	await app.exit();
});

test('content taller than the Shell is cut; the status line keeps its row', async () => {
	const app = await settled(<Box flexDirection="column" flexShrink={0}>{TEXT.map(line => <Text key={line}>{line}</Text>)}</Box>, 40, 6);
	expect(app.lines()[0]).toBe('line 1 alpha');
	expect(app.lines()[4]).toBe('line 5 epsilon');
	expect(app.lines()[5]).toStartWith(' NORMAL  h');
	await app.exit();
});

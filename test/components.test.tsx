import {expect, test} from 'bun:test';
import {Box, Canvas, Confirm, Form, List, Modal, Pager, rgb, Select, Shell, Split, Table, Text, useEffect, useFinish, useKeys, useState, type FormValues} from '../src/kit/index.js';
import {headless} from '../src/kit/testing.js';

function FormApp() {
	const finish = useFinish();
	return (
		<Shell title="Form">
			<Form
				fields={[
					{name: 'name', label: 'Name', type: 'text'},
					{name: 'stack', label: 'Stack', type: 'select', options: ['bun', 'python', 'go']},
					{name: 'git', label: 'Git', type: 'checkbox'},
				]}
				onSubmit={finish}
			/>
		</Shell>
	);
}

test('form: type in insert mode, cycle a choice, tick a box, submit', async () => {
	const app = await headless(<FormApp />, {cols: 80, rows: 12});
	await app.press('i');
	expect(app.screen()).toContain('INSERT');
	await app.type('invoices 2026');
	await app.press('<BS><Esc>');
	expect(app.screen()).toContain('invoices 202');
	await app.press('jll');
	expect(app.screen()).toContain('‹ go ›');
	await app.press('j<CR>');
	expect(app.screen()).toContain('[x]');
	await app.press('j<CR>');
	expect(app.result()).toEqual({value: {name: 'invoices 202', stack: 'go', git: true}});
	await app.exit();
});

test('form: Enter in insert mode leaves the field and moves on, Ctrl-s submits', async () => {
	const app = await headless(<FormApp />, {cols: 80, rows: 12});
	await app.type('iabc\r');
	expect(app.screen()).toContain('NORMAL');
	expect(app.screen()).toMatch(/› Stack/);
	await app.press('<C-s>');
	expect(app.result()).toEqual({value: {name: 'abc', stack: 'bun', git: false}});
	await app.exit();
});

function SelectApp() {
	const finish = useFinish();
	return (
		<Shell title="Choose">
			<Select options={[{label: 'One', value: 1}, {label: 'Two', value: 2, hint: 'the second'}, {label: 'Three', value: 3}]} onSelect={finish} />
		</Shell>
	);
}

test('select: filter with / then choose with Enter', async () => {
	const app = await headless(<SelectApp />, {cols: 60, rows: 10});
	expect(app.screen()).toContain('the second');
	await app.press('/thr<CR>');
	expect(app.screen()).not.toContain('Two');
	await app.press('<CR>');
	expect(app.result()).toEqual({value: 3});
	await app.exit();
});

type Row = {name: string; mb: number};

function TableApp() {
	const finish = useFinish();
	const rows: Row[] = [{name: 'beta', mb: 3}, {name: 'alpha', mb: 10}, {name: 'gamma', mb: 1}];
	return (
		<Shell title="Table">
			<Table<Row> columns={[{key: 'name', title: 'Name'}, {key: 'mb', title: 'MB', align: 'right'}]} rows={rows} onOpen={finish} />
		</Shell>
	);
}

test('table: header, sort by column, open a row', async () => {
	const app = await headless(<TableApp />, {cols: 60, rows: 10});
	expect(app.lines()[0]).toContain('Name');
	await app.press('s');
	expect(app.lines()[0]).toContain('Name ↑');
	expect(app.lines()[1]).toContain('alpha');
	await app.press('sS');
	expect(app.lines()[0]).toContain('MB ↓');
	await app.press('<CR>');
	expect(app.result()).toEqual({value: {name: 'alpha', mb: 10}});
	await app.exit();
});

function ConfirmApp() {
	const finish = useFinish();
	return (
		<Shell title="Confirm">
			<Confirm question="Proceed?" onAnswer={finish} />
		</Shell>
	);
}

test('confirm: n answers no even though Shell binds keys too', async () => {
	const app = await headless(<ConfirmApp />, {cols: 60, rows: 6});
	await app.press('n');
	expect(app.result()).toEqual({value: false});
	await app.exit();
});

test('form: keys sent in one chunk act on fresh state', async () => {
	const app = await headless(<FormApp />, {cols: 80, rows: 12});
	// An agent typing the whole form at once: name, two choices on, tick, submit.
	await app.type('iabc\rlljx');
	await app.settle(60);
	await app.press('<C-s>');
	expect(app.result()).toEqual({value: {name: 'abc', stack: 'go', git: true}});
	await app.exit();
});

test('form: Space types a space, Tab and arrows type nothing, Ctrl-s submits while typing', async () => {
	const app = await headless(<FormApp />, {cols: 80, rows: 12});
	await app.press('iJane<Space>Doe<Tab><Left><C-s>');
	expect(app.result()).toEqual({value: {name: 'Jane Doe', stack: 'bun', git: false}});
	await app.exit();
});

test('after finish the last frame matches the submitted values', async () => {
	const app = await headless(<FormApp />, {cols: 80, rows: 12});
	await app.press('jlj<CR><C-s>');
	expect(app.result()).toEqual({value: {name: '', stack: 'python', git: true}});
	expect(app.screen()).toContain('‹ python ›');
	expect(app.screen()).toContain('[x]');
	await app.exit();
});

test('q exits and keeps the last frame; a render error is reported', async () => {
	const app = await headless(<FormApp />, {cols: 80, rows: 12});
	await app.press('q');
	expect(app.exited()).toBe(true);
	expect(app.result()).toBeUndefined();
	expect(app.screen()).toContain('Submit');
	await app.exit();

	function Broken(): never {
		throw new Error('broken');
	}
	const broken = await headless(<Shell title="x"><Broken /></Shell>, {cols: 60, rows: 8});
	await broken.settle(60);
	expect(broken.exited()).toBe(true);
	expect(String(broken.error())).toContain('broken');
	await broken.exit();
});

test('canvas asked for kitty without GUI_GRAPHICS=kitty draws braille', async () => {
	function Kitty() {
		return (
			<Shell title="k">
				<Canvas backend="kitty" version={1} draw={(raster, {sx, sy}) => raster.line(0, 0, 20 * sx, 3 * sy, 0, [0, 0, 0])} />
			</Shell>
		);
	}
	const app = await headless(<Kitty />, {cols: 60, rows: 8});
	expect(app.screen()).toMatch(/[⠁-⣿]/);
	expect(app.screen()).not.toContain(String.fromCodePoint(0x10_EE_EE));
	await app.exit();
});

test('a Form and a Confirm inside a Modal get their keys', async () => {
	function ModalForm() {
		const finish = useFinish();
		const [step, setStep] = useState<'form' | 'confirm'>('form');
		const [name, setName] = useState('');
		return (
			<Shell title="m">
				<Modal title="New note" onClose={() => finish('closed')}>
					{step === 'form' ? (
						<Form fields={[{name: 'title', label: 'Title', type: 'text'}]} onSubmit={values => {
							setName(String(values['title']));
							setStep('confirm');
						}} />
					) : (
						<Confirm question="Save?" onAnswer={yes => finish(yes ? name : null)} />
					)}
				</Modal>
			</Shell>
		);
	}
	const app = await headless(<ModalForm />, {cols: 70, rows: 14});
	await app.press('iGroceries<Space>Saturday<C-s>');
	expect(app.screen()).toContain('Save?');
	await app.press('y');
	expect(app.result()).toEqual({value: 'Groceries Saturday'});
	await app.exit();
});

test('help keeps its keys while the app redraws on its own', async () => {
	function Ticking() {
		const [tick, setTick] = useState(0);
		useEffect(() => {
			const timer = setInterval(() => setTick(value => value + 1), 15);
			return () => clearInterval(timer);
		}, []);
		return <Shell title={`t${tick % 10}`}><List items={['a', 'b']} text={item => item} render={item => <Text>{item}</Text>} /></Shell>;
	}
	const app = await headless(<Ticking />, {cols: 80, rows: 24});
	await app.press('?');
	await app.settle(80);
	expect(app.screen()).toContain('Half page down');
	await app.exit();
});

test('a list in a box sized by its content shows its rows', async () => {
	function Boxed() {
		return (
			<Shell title="b">
				<Box flexDirection="column">
					<Text>above</Text>
					<List items={['one', 'two', 'three']} text={item => item} render={item => <Text>{item}</Text>} />
				</Box>
			</Shell>
		);
	}
	const app = await headless(<Boxed />, {cols: 40, rows: 10});
	expect(app.screen()).toContain('three');
	await app.exit();
});

test('chunks: Ctrl keys inside text act as keys, text starting with < stays text', async () => {
	const app = await headless(<FormApp />, {cols: 80, rows: 12});
	await app.type('i<b>Anna\u0013');
	expect(app.result()).toEqual({value: {name: '<b>Anna', stack: 'bun', git: false}});
	await app.exit();
});

test('digit keys, an unfinished sequence, and a throwing handler', async () => {
	const log: string[] = [];
	function Keys() {
		useKeys([
			{keys: '1', desc: 'One', run: () => log.push('1')},
			{keys: 'g', desc: 'G', run: () => log.push('g')},
			{keys: 'gt', desc: 'Gt', run: () => log.push('gt')},
			{keys: 'x', desc: 'X', run: () => log.push('x')},
			{keys: 'b', desc: 'Boom', run: () => {
				throw new Error('boom');
			}},
		]);
		return <Shell title="k"><Text>keys</Text></Shell>;
	}
	const app = await headless(<Keys />, {cols: 60, rows: 6});
	await app.press('1gxgt');
	expect(log).toEqual(['1', 'g', 'x', 'gt']);
	await app.press('b');
	await app.settle(40);
	expect(app.exited()).toBe(true);
	expect(String(app.error())).toContain('boom');
	await app.exit();
});

test('rgb turns a theme color into a Canvas color', () => {
	expect(rgb('#7aa2f7')).toEqual([0x7A, 0xA2, 0xF7]);
});

test('clicks stop at an open Modal, and / goes back to the list after it closes', async () => {
	const opened: string[] = [];
	function Screen() {
		const [open, setOpen] = useState(true);
		return (
			<Shell title="m">
				<List items={['alpha', 'beta', 'gamma', 'delta']} text={item => item} onOpen={item => opened.push(item)} render={item => <Text>{item}</Text>} />
				{open ? (
					<Modal title="Choose" onClose={() => setOpen(false)}>
						<Select options={[{label: 'one', value: 1}, {label: 'two', value: 2}]} onSelect={() => setOpen(false)} />
					</Modal>
				) : null}
			</Shell>
		);
	}
	const app = await headless(<Screen />, {cols: 60, rows: 16});
	await app.mouse('down', 2, 0);
	await app.mouse('down', 2, 0);
	expect(opened).toEqual([]);
	await app.press('<CR>');
	expect(app.screen()).not.toContain('Choose');
	await app.press('/gam<CR>');
	expect(app.screen()).toContain('gamma');
	expect(app.screen()).not.toContain('alpha');
	await app.exit();
});

test('a misspelled key name stops the app with a clear error', async () => {
	function Wrong() {
		useKeys([{keys: '<Enter>', desc: 'x', run: () => {}}]);
		return <Shell title="w"><Text>x</Text></Shell>;
	}
	const app = await headless(<Wrong />, {cols: 60, rows: 6});
	await app.settle(40);
	expect(String(app.error())).toContain('Unknown key <Enter>');
	await app.exit();
});

test('table rows may be declared with an interface; named keys reach bindings', async () => {
	interface Product {name: string; price: number}
	const log: string[] = [];
	function Shop() {
		useKeys([{keys: '<S-Tab>', desc: 's', run: () => log.push('stab')}, {keys: '<Home>', desc: 'h', run: () => log.push('home')}]);
		const rows: Product[] = [{name: 'bread', price: 1.5}];
		return <Shell title="t"><Table<Product> columns={[{key: 'name', title: 'Name'}, {key: 'price', title: 'Price', align: 'right', format: value => value.toFixed(2)}]} rows={rows} /></Shell>;
	}
	const app = await headless(<Shop />, {cols: 60, rows: 6});
	expect(app.screen()).toContain('1.50');
	await app.press('<S-Tab><Home>');
	expect(log).toEqual(['stab', 'home']);
	await expect(app.press('<Enter>')).rejects.toThrow('cannot send');
	await app.exit();
});

test('form: a click in the next Split pane or outside its Modal does not reach it', async () => {
	const submits: FormValues[] = [];
	const fields = [{name: 'ok', label: 'OK', type: 'checkbox' as const}];
	const app = await headless(
		<Shell title="f">
			<Split panes={[
				active => <Form fields={fields} onSubmit={values => submits.push(values)} active={active} />,
				active => <List items={['one', 'two', 'three', 'four']} text={item => item} render={item => <Text>{item}</Text>} active={active} />,
			]} />
		</Shell>,
		{cols: 80, rows: 10},
	);
	// Row 1 is the checkbox, row 3 the Submit row, in both panes. A click in
	// the right pane focuses it; the form, still active then, must ignore it.
	await app.mouse('down', 60, 1);
	expect(app.lines()[1]).toContain('[ ]');
	await app.press('<C-w>hj');
	await app.mouse('down', 60, 3);
	expect(submits).toEqual([]);
	// Inside its own pane a click still works: select the box, then tick it.
	await app.press('<C-w>h');
	await app.mouse('down', 4, 1);
	await app.mouse('down', 4, 1);
	expect(app.lines()[1]).toContain('[x]');
	await app.exit();

	function InModal() {
		return (
			<Shell title="m">
				<Text>below</Text>
				<Modal title="Options" onClose={() => {}}>
					<Form fields={[{name: 'force', label: 'Force', type: 'checkbox'}]} onSubmit={values => submits.push(values)} />
				</Modal>
			</Shell>
		);
	}
	const modal = await headless(<InModal />, {cols: 80, rows: 14});
	const submit = modal.lines().findIndex(line => line.includes(' Submit '));
	await modal.press('j');
	await modal.mouse('down', 1, submit);
	expect(submits).toEqual([]);
	await modal.mouse('down', modal.lines()[submit]!.indexOf('Submit'), submit);
	expect(submits).toEqual([{force: false}]);
	await modal.exit();
});

test('list: onCursor reports the highlighted item as it moves, filters and changes', async () => {
	const seen: (string | undefined)[] = [];
	function Cursor() {
		const [items, setItems] = useState(['alpha', 'beta', 'gamma']);
		const [shown, setShown] = useState(true);
		useKeys([
			{keys: 'R', desc: 'Replace', run: () => setItems(['zeta', 'beta'])},
			{keys: 'U', desc: 'Unmount', run: () => setShown(false)},
		]);
		return <Shell title="c">{shown ? <List items={items} text={item => item} render={item => <Text>{item}</Text>} onCursor={item => seen.push(item)} /> : <Text>gone</Text>}</Shell>;
	}
	const app = await headless(<Cursor />, {cols: 40, rows: 8});
	expect(seen).toEqual(['alpha']);
	await app.press('j');
	await app.press('j');
	expect(seen).toEqual(['alpha', 'beta', 'gamma']);
	// At the end already: no change, no call.
	await app.press('j');
	expect(seen).toHaveLength(3);
	await app.press('/be<CR>');
	expect(seen.at(-1)).toBe('beta');
	await app.press('/zzz<CR>');
	expect(seen.at(-1)).toBeUndefined();
	await app.press('/<CR>');
	expect(seen.at(-1)).toBe('alpha');
	await app.press('R');
	expect(seen.at(-1)).toBe('zeta');
	await app.press('U');
	expect(seen.at(-1)).toBeUndefined();
	await app.exit();
});

test('list: onCursor with items rebuilt on every render does not loop', async () => {
	let calls = 0;
	let renders = 0;
	function Rebuilt() {
		const [, setPicked] = useState<{name: string} | undefined>();
		renders++;
		const items = ['a', 'b'].map(name => ({name}));
		return <Shell title="r"><List items={items} text={item => item.name} render={item => <Text>{item.name}</Text>} onCursor={item => {
			calls++;
			setPicked(item);
		}} /></Shell>;
	}
	const app = await headless(<Rebuilt />, {cols: 40, rows: 6});
	await app.settle(100);
	const before = renders;
	await app.settle(100);
	expect(renders).toBe(before);
	expect(calls).toBe(1);
	await app.press('j');
	expect(calls).toBe(2);
	await app.exit();
});

test('select and table pass onCursor on: the value, and the row under the cursor after a sort', async () => {
	const values: (number | undefined)[] = [];
	const select = await headless(
		<Shell title="s"><Select options={[{label: 'one', value: 1}, {label: 'two', value: 2}]} onSelect={() => {}} onCursor={value => values.push(value)} /></Shell>,
		{cols: 40, rows: 6},
	);
	await select.press('j');
	expect(values).toEqual([1, 2]);
	await select.exit();

	const rows: (string | undefined)[] = [];
	type Fruit = {name: string; price: number};
	const fruits: Fruit[] = [{name: 'pear', price: 3}, {name: 'apple', price: 1}, {name: 'fig', price: 2}];
	const table = await headless(
		<Shell title="t"><Table<Fruit> columns={[{key: 'name', title: 'Name'}, {key: 'price', title: 'Price', align: 'right'}]} rows={fruits} onCursor={row => rows.push(row?.name)} /></Shell>,
		{cols: 40, rows: 8},
	);
	expect(rows).toEqual(['pear']);
	await table.press('s');
	expect(rows).toEqual(['pear', 'apple']);
	await table.press('S');
	expect(rows).toEqual(['pear', 'apple', 'pear']);
	await table.press('j');
	expect(rows).toEqual(['pear', 'apple', 'pear', 'fig']);
	await table.exit();
});

test('table: in a narrow pane the last column is cut and the others keep their width', async () => {
	type Port = {command: string; pid: number; address: string};
	const ports: Port[] = [{command: 'node', pid: 4242, address: '127.0.0.1:3000 and a long tail'}, {command: 'postgres', pid: 301, address: '[::1]:5432'}];
	const app = await headless(
		<Shell title="n"><Box width={30}><Table<Port> columns={[{key: 'command', title: 'Command'}, {key: 'pid', title: 'PID', align: 'right'}, {key: 'address', title: 'Address'}]} rows={ports} /></Box></Shell>,
		{cols: 40, rows: 6},
	);
	// PID keeps its 4 digits under its title; the address is cut at the edge.
	expect(app.lines().slice(0, 3)).toEqual([' Command       PID Address', '▌node         4242 127.0.0.1:3', ' postgres      301 [::1]:5432']);
	await app.exit();
});

test('mouse: wheel reports that arrive in one read each scroll from the previous one', async () => {
	const wheel = (x: number, y: number) => `\u001B[<65;${x + 1};${y + 1}M`;
	const items = Array.from({length: 40}, (_, index) => `item ${index}`);
	const list = await headless(<Shell title="w"><List items={items} text={item => item} render={item => <Text>{item}</Text>} /></Shell>, {cols: 40, rows: 12});
	await list.type(wheel(3, 2).repeat(5));
	expect(list.screen()).toContain('▌item 15');
	await list.exit();

	const text = Array.from({length: 100}, (_, index) => `line ${index + 1}`);
	const pager = await headless(<Shell title="p"><Pager text={text} /></Shell>, {cols: 40, rows: 12});
	await pager.type(wheel(3, 2).repeat(5));
	expect(pager.lines()[0]).toBe('line 16');
	await pager.exit();
});

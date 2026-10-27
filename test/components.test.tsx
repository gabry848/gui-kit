import {expect, test} from 'bun:test';
import {Canvas, Confirm, Form, Select, Shell, Table, useFinish} from '../src/kit/index.js';
import {headless} from '../src/kit/testing.js';

function FormApp() {
	const finish = useFinish();
	return (
		<Shell title="Form">
			<Form
				fields={[
					{name: 'nome', label: 'Nome', type: 'text'},
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
	await app.type('fatture 2026');
	await app.press('<BS><Esc>');
	expect(app.screen()).toContain('fatture 202');
	await app.press('jll');
	expect(app.screen()).toContain('‹ go ›');
	await app.press('j<CR>');
	expect(app.screen()).toContain('[x]');
	await app.press('j<CR>');
	expect(app.result()).toEqual({value: {nome: 'fatture 202', stack: 'go', git: true}});
	await app.exit();
});

test('form: Enter in insert mode leaves the field and moves on, Ctrl-s submits', async () => {
	const app = await headless(<FormApp />, {cols: 80, rows: 12});
	await app.type('iabc\r');
	expect(app.screen()).toContain('NORMAL');
	expect(app.screen()).toMatch(/› Stack/);
	await app.press('<C-s>');
	expect(app.result()).toEqual({value: {nome: 'abc', stack: 'bun', git: false}});
	await app.exit();
});

function SelectApp() {
	const finish = useFinish();
	return (
		<Shell title="Scegli">
			<Select options={[{label: 'Uno', value: 1}, {label: 'Due', value: 2, hint: 'il secondo'}, {label: 'Tre', value: 3}]} onSelect={finish} />
		</Shell>
	);
}

test('select: filter with / then choose with Enter', async () => {
	const app = await headless(<SelectApp />, {cols: 60, rows: 10});
	expect(app.screen()).toContain('il secondo');
	await app.press('/tr<CR>');
	expect(app.screen()).not.toContain('Due');
	await app.press('<CR>');
	expect(app.result()).toEqual({value: 3});
	await app.exit();
});

type Row = {nome: string; mb: number};

function TableApp() {
	const finish = useFinish();
	const rows: Row[] = [{nome: 'beta', mb: 3}, {nome: 'alfa', mb: 10}, {nome: 'gamma', mb: 1}];
	return (
		<Shell title="Tabella">
			<Table<Row> columns={[{key: 'nome', title: 'Nome'}, {key: 'mb', title: 'MB', align: 'right'}]} rows={rows} onOpen={finish} />
		</Shell>
	);
}

test('table: header, sort by column, open a row', async () => {
	const app = await headless(<TableApp />, {cols: 60, rows: 10});
	expect(app.lines()[0]).toContain('Nome');
	await app.press('s');
	expect(app.lines()[0]).toContain('Nome ↑');
	expect(app.lines()[1]).toContain('alfa');
	await app.press('sS');
	expect(app.lines()[0]).toContain('MB ↓');
	await app.press('<CR>');
	expect(app.result()).toEqual({value: {nome: 'alfa', mb: 10}});
	await app.exit();
});

function ConfirmApp() {
	const finish = useFinish();
	return (
		<Shell title="Conferma">
			<Confirm question="Procedo?" onAnswer={finish} />
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
	expect(app.result()).toEqual({value: {nome: 'abc', stack: 'go', git: true}});
	await app.exit();
});

test('form: Space types a space, Tab and arrows type nothing, Ctrl-s submits while typing', async () => {
	const app = await headless(<FormApp />, {cols: 80, rows: 12});
	await app.press('iMario<Space>Rossi<Tab><Left><C-s>');
	expect(app.result()).toEqual({value: {nome: 'Mario Rossi', stack: 'bun', git: false}});
	await app.exit();
});

test('after finish the last frame matches the submitted values', async () => {
	const app = await headless(<FormApp />, {cols: 80, rows: 12});
	await app.press('jlj<CR><C-s>');
	expect(app.result()).toEqual({value: {nome: '', stack: 'python', git: true}});
	expect(app.screen()).toContain('‹ python ›');
	expect(app.screen()).toContain('[x]');
	await app.exit();
});

test('q exits and keeps the last frame; a render error is reported', async () => {
	const app = await headless(<FormApp />, {cols: 80, rows: 12});
	await app.press('q');
	expect(app.exited()).toBe(true);
	expect(app.result()).toBeUndefined();
	expect(app.screen()).toContain('Conferma');
	await app.exit();

	function Broken(): never {
		throw new Error('rotto');
	}
	const broken = await headless(<Shell title="x"><Broken /></Shell>, {cols: 60, rows: 8});
	await broken.settle(60);
	expect(broken.exited()).toBe(true);
	expect(String(broken.error())).toContain('rotto');
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

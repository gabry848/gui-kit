import {expect, test} from 'bun:test';
import {Demo} from '../src/apps/demo/Demo.js';
import {headless} from '../src/kit/testing.js';

test('list moves with counts, filters with / and opens a modal', async () => {
	const app = await headless(<Demo />, {cols: 100, rows: 30});
	expect(app.screen()).toContain('500 elementi');
	expect(app.screen()).toContain('▌bilancio-001');

	await app.press('5j');
	expect(app.screen()).toContain('▌render-006');
	expect(app.screen()).toContain(' bilancio-001');

	await app.press('G');
	expect(app.screen()).toContain('▌logo-500');

	await app.press('gg/schema<CR>');
	expect(app.screen()).toContain('Filtro: schema');
	expect(app.screen()).not.toContain('bilancio-001');

	await app.press('<CR>');
	expect(app.screen()).toContain('Tipo:');
	await app.press('dd');
	expect(app.screen()).toContain('Eliminato schema-005');
	await app.exit();
});

test('mouse wheel scrolls and a click selects a row', async () => {
	const app = await headless(<Demo />, {cols: 100, rows: 30});
	await app.mouse('wheelDown', 10, 5);
	expect(app.screen()).toContain('▌fattura-004');
	// Screen row 2 is the first list row: tabs, header, then items.
	await app.mouse('down', 10, 4);
	expect(app.screen()).toContain('▌progetto-003');
	await app.exit();
});

test('space shows the leader menu, ? shows help', async () => {
	const app = await headless(<Demo />, {cols: 100, rows: 30});
	await app.press('<Space>');
	expect(app.screen()).toContain('Vai al canvas');
	await app.press('<Esc>');
	await app.press('?');
	expect(app.screen()).toContain('Aiuto');
	expect(app.screen()).toContain('Mezza pagina giù');
	await app.press('<Esc>');
	expect(app.screen()).not.toContain('Mezza pagina giù');
	await app.exit();
});

test('canvas draws with the keyboard and the mouse in braille', async () => {
	const app = await headless(<Demo />, {cols: 100, rows: 30});
	await app.press('gt');
	expect(app.screen()).toContain('resa braille');
	const before = app.screen();

	await app.press('<CR>10l<CR>');
	await app.mouse('down', 20, 15);
	await app.mouse('drag', 40, 18);
	await app.mouse('drag', 60, 20);
	await app.mouse('up', 60, 20);
	await app.settle(60);
	const after = app.screen();
	expect(after).not.toBe(before);
	expect((after.match(/[⠁-⣿]/g) ?? []).length).toBeGreaterThan(30);

	await app.press('u');
	await app.settle(60);
	expect((app.screen().match(/[⠁-⣿]/g) ?? []).length).toBeLessThan((after.match(/[⠁-⣿]/g) ?? []).length);
	await app.exit();
});

test('text that arrives in one chunk still works key by key', async () => {
	const app = await headless(<Demo />, {cols: 100, rows: 30});
	await app.type('/schema\r');
	expect(app.screen()).toContain('Filtro: schema');
	expect(app.screen()).toContain('▌schema-005');
	await app.exit();
});

import {expect, test} from 'bun:test';
import {Pager, Shell, useKeys, useState} from '../src/kit/index.js';
import {cleanLine} from '../src/kit/components/Pager.js';
import {headless} from '../src/kit/testing.js';

const THOUSAND = Array.from({length: 1000}, (_, index) => `line ${index + 1}`).join('\n') + '\n';

// 12 rows: 10 of text, the position line, the status line.
const open = (text: string | string[], follow = false) => headless(<Shell title="p"><Pager text={text} follow={follow} /></Shell>, {cols: 60, rows: 12});

test('pager: j/k with counts, half and full pages, gg and G', async () => {
	const app = await open(THOUSAND);
	expect(app.lines()[0]).toBe('line 1');
	expect(app.lines()[10]).toBe('1-10/1000');
	await app.press('j');
	expect(app.lines()[0]).toBe('line 2');
	await app.press('5j');
	expect(app.lines()[0]).toBe('line 7');
	await app.press('<C-d>');
	expect(app.lines()[0]).toBe('line 12');
	await app.press('<C-f>');
	expect(app.lines()[0]).toBe('line 22');
	await app.press('<C-b><C-u>k');
	expect(app.lines()[0]).toBe('line 6');
	await app.press('G');
	expect(app.lines()[9]).toBe('line 1000');
	expect(app.lines()[10]).toBe('991-1000/1000');
	await app.press('j');
	expect(app.lines()[0]).toBe('line 991');
	await app.press('gg');
	expect(app.lines()[0]).toBe('line 1');
	await app.press('k');
	expect(app.lines()[0]).toBe('line 1');
	await app.exit();
});

test('pager: / searches as you type, n and N move between matches and wrap', async () => {
	const app = await open(THOUSAND);
	await app.press('/line 50');
	// line 50 is on screen once the view moves there; the search line shows the text typed.
	expect(app.lines()[0]).toBe('line 50');
	await app.press('<CR>');
	expect(app.lines()[10]).toBe('50-59/1000  /line 50  1/11');
	await app.press('n');
	expect(app.lines()[0]).toBe('line 500');
	expect(app.lines()[10]).toContain('2/11');
	await app.press('n');
	// line 501 is already on screen: the view stays.
	expect(app.lines()[0]).toBe('line 500');
	expect(app.lines()[10]).toContain('3/11');
	await app.press('NN');
	expect(app.lines()[0]).toBe('line 50');
	await app.press('N');
	expect(app.screen()).toContain('Search hit TOP, continuing at BOTTOM');
	expect(app.lines()[10]).toContain('11/11');
	expect(app.screen()).toContain('line 509');
	await app.press('/nothing<CR>');
	expect(app.screen()).toContain('Pattern not found: nothing');
	expect(app.lines()[10]).toContain('/nothing  no match');
	await app.exit();
});

test('pager: Esc during a search goes back to where it started', async () => {
	const app = await open(THOUSAND);
	await app.press('3j/line 700');
	expect(app.lines()[0]).toBe('line 700');
	await app.press('<Esc>');
	expect(app.lines()[0]).toBe('line 4');
	expect(app.lines()[10]).toBe('4-13/1000');
	await app.press('n');
	expect(app.screen()).toContain('No previous search');
	await app.exit();
});

test('pager: follow mode sticks to the end as lines arrive; scrolling up leaves it, F turns it back on', async () => {
	function Growing() {
		const [lines, setLines] = useState(['first']);
		useKeys([{keys: 'a', desc: 'Append', run: () => setLines(current => [...current, ...Array.from({length: 15}, (_, index) => `added ${current.length + index}`)])}]);
		return <Shell title="f"><Pager text={lines} follow /></Shell>;
	}
	const app = await headless(<Growing />, {cols: 60, rows: 12});
	expect(app.lines()[10]).toBe('1-1/1  FOLLOW');
	await app.press('a');
	expect(app.lines()[9]).toBe('added 15');
	await app.press('a');
	expect(app.lines()[9]).toBe('added 30');
	expect(app.lines()[10]).toBe('22-31/31  FOLLOW');
	await app.press('k');
	expect(app.lines()[10]).toBe('21-30/31');
	await app.press('a');
	expect(app.lines()[0]).toBe('added 20');
	await app.press('F');
	expect(app.lines()[9]).toBe('added 45');
	expect(app.lines()[10]).toContain('FOLLOW');
	await app.press('F');
	await app.press('a');
	expect(app.lines()[9]).toBe('added 45');
	await app.exit();
});

test('pager: escapes are removed, tabs expanded, a carriage return keeps the last drawing', async () => {
	const text = ['\u001B[31mred\u001B[0m and \u001B[1mbold\u001B[22m', 'a\tb', 'progress 10%\rprogress 100%', 'crlf\r', '\u001B]0;title\u0007after osc', 'bell\u0007'];
	const app = await open(text);
	expect(app.lines().slice(0, 6)).toEqual(['red and bold', 'a       b', 'progress 100%', 'crlf', 'after osc', 'bell']);
	await app.exit();
});

test('pager: ansi keeps colors and removes the other escapes', async () => {
	expect(cleanLine('\u001B[31mred\u001B[0m\u001B[2K\u001B[1A', true)).toBe('\u001B[31mred\u001B[0m');
	expect(cleanLine('\u001B[31mred\u001B[0m\u001B[2K')).toBe('red');
	const app = await headless(<Shell title="a"><Pager text={'\u001B[32mgreen\u001B[0m text\u001B[K'} ansi /></Shell>, {cols: 40, rows: 6});
	expect(app.lines()[0]).toBe('green text');
	await app.exit();
});

test('pager: the mouse wheel scrolls', async () => {
	const app = await open(THOUSAND);
	await app.mouse('wheelDown', 5, 3);
	expect(app.lines()[0]).toBe('line 4');
	await app.mouse('wheelUp', 5, 3);
	expect(app.lines()[0]).toBe('line 1');
	await app.exit();
});

test('pager: 100k lines stay fast', async () => {
	const huge = Array.from({length: 100_000}, (_, index) => `row ${index + 1} ${'x'.repeat(index % 50)}`).join('\n');
	const started = performance.now();
	const app = await headless(<Shell title="big"><Pager text={huge} /></Shell>, {cols: 100, rows: 30});
	const opened = performance.now() - started;
	const times: number[] = [];
	for (const keys of ['G', 'gg', '<C-f>', '50j', '/row 50000 x<CR>', 'n', 'k']) {
		const start = performance.now();
		await app.press(keys);
		times.push(performance.now() - start);
	}
	expect(app.lines()[0]).toStartWith('row 49999 ');
	expect(app.lines()[28]).toContain('/row 50000 x  1/1');
	// press() itself waits about 40 ms after the keys.
	expect(opened).toBeLessThan(1500);
	for (const time of times) expect(time).toBeLessThan(400);
	await app.exit();
});

test('pager: a tab after an escape lands on the visible column, with and without ansi', async () => {
	// The b goes to column 8 whatever the escapes before it.
	expect(cleanLine('\u001B[31mred\u001B[0m\tb')).toBe('red     b');
	expect(cleanLine('red\tb')).toBe('red     b');
	expect(cleanLine('\u001B[31mred\u001B[0m\tb', true)).toBe('\u001B[31mred\u001B[0m     b');
	expect(cleanLine('\u001B]0;title\u0007a\tb\tc')).toBe('a       b       c');
	const app = await headless(<Shell title="t"><Pager text={['\u001B[31mred\u001B[0m\tb', 'red\tb']} ansi /></Shell>, {cols: 40, rows: 6});
	expect(app.lines().slice(0, 2)).toEqual(['red     b', 'red     b']);
	await app.exit();
});

test('pager: with ansi, search matches the visible text, not the color codes', async () => {
	const app = await headless(<Shell title="s"><Pager text={['\u001B[31mred\u001B[0m', 'plain', '\u001B[1mbold red\u001B[22m']} ansi /></Shell>, {cols: 40, rows: 8});
	await app.press('/31<CR>');
	expect(app.screen()).toContain('/31  no match');
	await app.press('/m<CR>');
	expect(app.screen()).toContain('/m  no match');
	await app.press('/red<CR>');
	expect(app.screen()).toContain('/red  1/2');
	await app.press('n');
	expect(app.screen()).toContain('/red  2/2');
	await app.exit();
});

test('pager: with offset, the view and the matches stay on their lines while old ones are cut', async () => {
	// Like useProcess at maxLines: each `a` adds 5 lines at the end and cuts 5 from the front.
	function Trimmed() {
		const [first, setFirst] = useState(0);
		const lines = Array.from({length: 40}, (_, index) => `line ${first + index + 1}`);
		useKeys([{keys: 'a', desc: 'Add and cut', run: () => setFirst(current => current + 5)}]);
		return <Shell title="o"><Pager text={lines} offset={first} /></Shell>;
	}
	// 6 rows: 4 of text, the position line, the status line.
	const app = await headless(<Trimmed />, {cols: 50, rows: 6});
	await app.press('10j');
	expect(app.lines()[0]).toBe('line 11');
	expect(app.lines()[4]).toBe('11-14/40');
	await app.press('a');
	expect(app.lines()[0]).toBe('line 11');
	expect(app.lines()[4]).toBe('11-14/45');
	await app.press('/line 13<CR>');
	expect(app.lines()[4]).toContain('/line 13  1/1');
	await app.press('a');
	expect(app.lines()[0]).toBe('line 11');
	expect(app.lines()[4]).toContain('11-14/50  /line 13  1/1');
	await app.press('n');
	expect(app.lines()[0]).toBe('line 11');
	expect(app.lines()[4]).toContain('/line 13  1/1');
	// Once its lines are cut, the view stays on the oldest one left.
	await app.press('aa');
	expect(app.lines()[0]).toBe('line 21');
	expect(app.lines()[4]).toContain('21-24/60  /line 13  no match');
	await app.exit();
});

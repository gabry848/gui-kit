import {expect, test} from 'bun:test';
import {Keymap, tokenize} from '../src/kit/keymap.js';

const layer = (keymap: Keymap, bindings: {keys: string; run: (count: number) => void}[], modal = false, priority = 0) =>
	keymap.addLayer({bindings: bindings.map(binding => ({...binding, desc: binding.keys})), modal, priority});

test('tokenize splits special keys', () => {
	expect(tokenize('<Space>fg<C-d>')).toEqual(['<Space>', 'f', 'g', '<C-d>']);
});

test('counts multiply a motion', () => {
	const keymap = new Keymap();
	let moved = 0;
	layer(keymap, [{keys: 'j', run: count => (moved += count)}]);
	for (const token of ['1', '2', 'j']) keymap.feed(token);
	expect(moved).toBe(12);
});

test('sequences wait for the next key and expose what can follow', () => {
	const keymap = new Keymap();
	const ran: string[] = [];
	layer(keymap, [
		{keys: 'gg', run: () => ran.push('gg')},
		{keys: 'gt', run: () => ran.push('gt')},
	]);
	keymap.feed('g');
	expect(keymap.state.next.map(binding => binding.keys)).toEqual(['gg', 'gt']);
	keymap.feed('t');
	expect(ran).toEqual(['gt']);
	expect(keymap.state.pending).toEqual([]);
});

test('a modal layer hides the ones below it', () => {
	const keymap = new Keymap();
	const ran: string[] = [];
	layer(keymap, [{keys: 'j', run: () => ran.push('list')}, {keys: 'q', run: () => ran.push('quit')}], false, -10);
	const modal = layer(keymap, [{keys: 'q', run: () => ran.push('close')}], true, 10);
	keymap.feed('j');
	keymap.feed('q');
	keymap.removeLayer(modal.id);
	keymap.feed('q');
	expect(ran).toEqual(['close', 'quit']);
	expect(keymap.state.message).toBe('');
});

test('command line runs registered commands', () => {
	const keymap = new Keymap();
	let args = '';
	keymap.command('backend', 'test', value => (args = value));
	keymap.openCmdline(':');
	for (const token of [...'backend', '<Space>', ...'half', '<CR>']) keymap.feed(token);
	expect(args).toBe('half');
	expect(keymap.state.mode).toBe('normal');
});

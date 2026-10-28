import {EventEmitter} from 'node:events';
import {expect, test} from 'bun:test';
import {InputSplitter} from '../src/kit/input.js';
import {probe} from '../src/kit/probe.js';
import {Text, useEffect, useKeys, useKit, useState} from '../src/kit/index.js';
import {headless} from '../src/kit/testing.js';

const ESC = '\u001B';
const ST = `${ESC}\\`;
// What Ghostty and kitty send back to the probe's queries (probe.ts), DA1 last.
const GHOSTTY = `${ESC}_Gi=31;OK${ST}${ESC}[?1016;1$y${ESC}[?2026;2$y${ESC}[?0u${ESC}[6;36;17t${ESC}P>|ghostty 1.3.1${ST}${ESC}[?62;22c`;
const KITTY = `${ESC}_Gi=31;OK${ST}${ESC}[?2026;2$y${ESC}[?1u${ESC}[6;32;16t${ESC}P>|kitty(0.42.1)\u0007${ESC}[?62;c`;
const ERROR = `${ESC}_Gi=31;ENOTSUPPORTED:no graphics${ST}`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function source() {
	return Object.assign(new EventEmitter(), {isTTY: true, setRawMode() {}, resume() {}, pause() {}, ref() {}, unref() {}});
}

/** A splitter on a fake stdin, and everything it hands to Ink once the chunks are in. */
async function split(chunks: string[]) {
	const stdin = source();
	const splitter = new InputSplitter(stdin as unknown as NodeJS.ReadStream);
	const replies: string[] = [];
	const mouse: string[] = [];
	splitter.on('reply', reply => replies.push(reply));
	splitter.on('mouse', report => mouse.push(report));
	for (const chunk of chunks) stdin.emit('data', Buffer.from(chunk));
	// Longer than the wait for the rest of a split sequence.
	await sleep(50);
	let text = '';
	for (let chunk = splitter.read(); chunk !== null; chunk = splitter.read()) text += chunk;
	return {text, replies, mouse};
}

test('replies to the probe never reach Ink, whole or split anywhere across two chunks', async () => {
	for (const reply of [GHOSTTY, KITTY, ERROR]) {
		const whole = await split([`a${reply}b`]);
		expect(whole.text).toBe('ab');
		expect(whole.replies.join('')).toBe(reply);
		const cuts = await Promise.all(Array.from({length: reply.length - 1}, (_, index) => split([`x${reply.slice(0, index + 1)}`, `${reply.slice(index + 1)}y`])));
		cuts.forEach(cut => expect(cut.text).toBe('xy'));
	}
	// Mixed with mouse reports, which still go out as 'mouse'.
	const mixed = await split([`${ESC}[<0;5;3M${GHOSTTY.slice(0, 20)}`, `${GHOSTTY.slice(20)}${ESC}[<0;5;3mj`]);
	expect(mixed).toMatchObject({text: 'j', mouse: [`${ESC}[<0;5;3M`, `${ESC}[<0;5;3m`]});
});

test('keys that start like a reply still reach Ink', async () => {
	const keys = [
		`${ESC}_`, // Alt+_
		`${ESC}P`, // Alt+P
		`${ESC}`, // Esc
		`${ESC}[6~`, // PageDown
		`${ESC}[6;5~`, // Ctrl+PageDown
		`${ESC}[97u`, // 'a' in the kitty keyboard protocol
		`${ESC}[27;5;9~`, // Ctrl+Tab with modifyOtherKeys
		`${ESC}[1;2A`, // Shift+Up
		'G', 'i=31;OK',
	];
	for (const key of keys) expect((await split([key])).text).toBe(key);
	// Esc alone is not held back.
	const stdin = source();
	const splitter = new InputSplitter(stdin as unknown as NodeJS.ReadStream);
	stdin.emit('data', Buffer.from(ESC));
	expect(splitter.read()).toBe(ESC);
	// Split in two, and Alt+_ followed by typed text.
	expect((await split([`${ESC}[6`, '~'])).text).toBe(`${ESC}[6~`);
	expect((await split([`${ESC}_Gx`])).text).toBe(`${ESC}_Gx`);
});

test('a reply that comes after the probe gave up is dropped by the splitter run() starts next', async () => {
	const stdin = source();
	const stdout = {
		isTTY: true,
		write(data: string) {
			if (data.includes(`${ESC}[c`)) setTimeout(() => stdin.emit('data', Buffer.from(GHOSTTY)), 60);
			return true;
		},
	};
	const caps = await probe(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream, 20);
	expect(caps.terminal).toBeUndefined();
	const splitter = new InputSplitter(stdin as unknown as NodeJS.ReadStream);
	await sleep(120);
	expect(splitter.read()).toBeNull();
});

test('a late reply neither types into a field in insert mode nor runs keys in normal mode', async () => {
	const fired: string[] = [];
	function Field({insert}: {insert: boolean}) {
		const {keymap} = useKit();
		const [text, setText] = useState('');
		useKeys(
			['G', 'i', 'c', 'u', 't', 'y', 'O', 'K', 'g', 'h', 'o', 's'].map(keys => ({keys, desc: keys, run: () => fired.push(keys)})),
			{onText: token => setText(value => value + token)},
		);
		useEffect(() => {
			if (insert) keymap.setMode('insert');
		}, []);
		return <Text>field:[{text}]</Text>;
	}
	const insert = await headless(<Field insert />, {cols: 60, rows: 4});
	await insert.type(GHOSTTY);
	await insert.type(`ok${KITTY}`);
	await insert.settle(80);
	expect(insert.lines()[0]).toBe('field:[ok]');
	await insert.exit();

	const normal = await headless(<Field insert={false} />, {cols: 60, rows: 4});
	await normal.type(GHOSTTY + KITTY);
	await normal.settle(80);
	expect(fired).toEqual([]);
	await normal.type('G');
	expect(fired).toEqual(['G']);
	await normal.exit();
});

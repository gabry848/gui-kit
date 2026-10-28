import {EventEmitter} from 'node:events';
import {expect, test} from 'bun:test';
import {DIACRITICS} from '../src/kit/canvas/diacritics.js';
import {KITTY_MAX_ID, KittyIds, kittyIds, kittyPlaceholders} from '../src/kit/canvas/encode.js';
import {Box, Canvas, Image, Text, useEffect, useFinish, useState, type Bitmap, type Caps} from '../src/kit/index.js';
import {runOn} from '../src/kit/runtime.js';
import {headless, TEST_CAPS} from '../src/kit/testing.js';

const ESC = '\u001B';
const ST = `${ESC}\\`;
const PLACEHOLDER = String.fromCodePoint(0x10_EE_EE);
const KITTY_CAPS: Caps = {...TEST_CAPS, graphics: 'kitty', kittyGraphicsDetected: true};
const PIC: Bitmap = {width: 2, height: 2, data: new Uint8ClampedArray(16).fill(200)};

const transmitted = (bytes: string) => [...bytes.matchAll(/\u001B_Ga=T,[^;]*\bi=(\d+)/g)].map(match => Number(match[1]));
const deleted = (bytes: string) => [...bytes.matchAll(/\u001B_Ga=d,d=I,i=(\d+)/g)].map(match => Number(match[1]));

test('KittyIds: never an id still in use, wraps around, fails only when every id is taken', () => {
	const ids = new KittyIds(4);
	expect([ids.take(), ids.take(), ids.take()]).toEqual([1, 2, 3]);
	ids.release(2);
	// In turn, not the freed one first: a just-deleted id is not reused at once.
	expect(ids.take()).toBe(4);
	// Wrapping skips 1 and 3, still in use.
	expect(ids.take()).toBe(2);
	expect(ids.live().sort()).toEqual([1, 2, 3, 4]);
	expect(() => ids.take()).toThrow('no free kitty image id');
	ids.release(3);
	expect(ids.take()).toBe(3);
	expect(new KittyIds().take()).toBe(1);
	expect(KITTY_MAX_ID).toBe(2 ** 32 - 1);
});

test('kitty placeholders carry the whole 32-bit id: 256 colors, then 24-bit color, then a third diacritic', () => {
	expect(kittyPlaceholders(2, 1, 7)[0]).toBe(`${ESC}[38;5;7m${PLACEHOLDER}${String.fromCodePoint(DIACRITICS[0]!, DIACRITICS[0]!)}${PLACEHOLDER}${String.fromCodePoint(DIACRITICS[0]!, DIACRITICS[1]!)}${ESC}[39m`);
	expect(kittyPlaceholders(1, 1, 256)[0]).toStartWith(`${ESC}[38;2;0;1;0m`);
	const mid = kittyPlaceholders(3, 2, 0x12_34_56);
	expect(mid[1]).toBe(`${ESC}[38;2;18;52;86m` + [0, 1, 2].map(col => PLACEHOLDER + String.fromCodePoint(DIACRITICS[1]!, DIACRITICS[col]!)).join('') + `${ESC}[39m`);
	const high = kittyPlaceholders(2, 2, 0x89_AB_CD_EF);
	const top = String.fromCodePoint(DIACRITICS[0x89]!);
	expect(high[0]).toBe(`${ESC}[38;2;171;205;239m` + [0, 1].map(col => PLACEHOLDER + String.fromCodePoint(DIACRITICS[0]!, DIACRITICS[col]!) + top).join('') + `${ESC}[39m`);
	expect(high[1]!.split(PLACEHOLDER).length - 1).toBe(2);
});

test('kitty: after 300 mounts the next images still get ids of their own, so a mounted logo keeps its picture', async () => {
	function Remounts() {
		const [n, setN] = useState(0);
		useEffect(() => {
			if (n >= 300) return;
			const timer = setTimeout(() => setN(n + 1), 1);
			return () => clearTimeout(timer);
		}, [n]);
		return (
			<Box flexDirection="column">
				<Image src={PIC} width={4} height={2} />
				<Image key={n} src={PIC} width={2} height={1} />
				<Text>n={n}</Text>
			</Box>
		);
	}
	const app = await headless(<Remounts />, {cols: 20, rows: 6, caps: KITTY_CAPS});
	for (let wait = 0; wait < 200 && !app.screen().includes('n=300'); wait++) await app.settle(20);
	expect(app.screen()).toContain('n=300');
	await app.settle(60);
	const out = app.output();
	const logo = transmitted(out)[0]!;
	// The logo is sent once and never deleted while it is mounted.
	expect(transmitted(out).filter(id => id === logo)).toHaveLength(1);
	expect(deleted(out)).not.toContain(logo);
	// Every remounted image deleted its own id, each a different one.
	const gone = deleted(out);
	expect(gone.length).toBeGreaterThanOrEqual(300);
	expect(new Set(gone).size).toBe(gone.length);
	expect(kittyIds.live()).toContain(logo);
	for (const id of gone) expect(kittyIds.live()).not.toContain(id);
	// The ids went past 255: the placeholders now name them in 24-bit color.
	const last = transmitted(out).at(-1)!;
	expect(last).toBeGreaterThan(255);
	expect(out).toContain(`38;2;${(last >>> 16) & 255};${(last >>> 8) & 255};${last & 255}m${PLACEHOLDER}`);
	await app.exit();
});

test('without kitty graphics, Image and Canvas take no kitty id and send no kitty deletes', async () => {
	const before = kittyIds.live().length;
	function Toggle() {
		const [shown, setShown] = useState(true);
		useEffect(() => {
			const timer = setTimeout(() => setShown(false), 60);
			return () => clearTimeout(timer);
		}, []);
		return shown ? (
			<Box flexDirection="column" height={4}>
				<Image src={PIC} width={4} height={2} />
				<Canvas backend="kitty" version={1} draw={() => {}} />
			</Box>
		) : <Text>gone</Text>;
	}
	const app = await headless(<Toggle />, {cols: 20, rows: 6});
	expect(kittyIds.live().length).toBe(before);
	await app.settle(100);
	expect(app.screen()).toContain('gone');
	expect(app.output()).not.toContain(`${ESC}_G`);
	await app.exit();
});

/** A terminal that answers the probe like kitty 0.42.1 and records every byte. */
function kittyTerminal() {
	const reply = `${ESC}_Gi=31;OK${ST}${ESC}[?2026;2$y${ESC}[?0u${ESC}[6;32;16t${ESC}P>|kitty(0.42.1)${ST}${ESC}[?62;c`;
	const stdin = Object.assign(new EventEmitter(), {isTTY: true, setRawMode() {}, setEncoding() {}, resume() {}, pause() {}, ref() {}, unref() {}});
	let log = '';
	const stdout = Object.assign(new EventEmitter(), {
		isTTY: true,
		columns: 40,
		rows: 10,
		write(data: string, ...rest: unknown[]) {
			log += String(data);
			if (String(data).includes(`${ESC}[c`)) setTimeout(() => stdin.emit('data', Buffer.from(reply)), 2);
			const done = rest.find(item => typeof item === 'function') as (() => void) | undefined;
			if (done) setTimeout(done, 0);
			return true;
		},
	});
	return {stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, log: () => log};
}

test('run frees its kitty images before it leaves the alternate screen, and sends no delete-all on the shell screen', async () => {
	const terminal = kittyTerminal();
	function App() {
		const finish = useFinish();
		useEffect(() => {
			const timer = setTimeout(() => finish('done'), 150);
			return () => clearTimeout(timer);
		}, []);
		return (
			<Box flexDirection="column">
				<Image src={PIC} width={4} height={2} />
				<Image src={PIC} width={2} height={1} />
			</Box>
		);
	}
	let graphics = '';
	const result = await runOn(terminal, caps => {
		graphics = caps.graphics;
		return <App />;
	});
	expect(graphics).toBe('kitty');
	expect(result).toEqual({finished: true, value: 'done'});
	const log = terminal.log();
	const ids = transmitted(log);
	expect(ids).toHaveLength(2);
	const leave = log.indexOf(`${ESC}[?1049l`);
	expect(leave).toBeGreaterThan(-1);
	for (const id of ids) {
		const free = log.indexOf(`${ESC}_Ga=d,d=I,i=${id},q=2${ST}`);
		expect(free).toBeGreaterThan(log.lastIndexOf(`${ESC}_Ga=T`));
		expect(free).toBeLessThan(leave);
		expect(kittyIds.live()).not.toContain(id);
	}
	expect(log).not.toContain('d=A');
	expect(log.slice(leave)).not.toContain(`${ESC}_G`);
});

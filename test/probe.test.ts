import {EventEmitter} from 'node:events';
import {expect, test} from 'bun:test';
import {capsFromReplies, probe, PROBE_QUERIES} from '../src/kit/probe.js';

const ESC = '\u001B';
const ST = `${ESC}\\`;
const KITTY_OK = `${ESC}_Gi=31;OK${ST}`;
const xtversion = (text: string) => `${ESC}P>|${text}${ST}`;

// Replies in the order the terminals send them, DA1 last.
const ghostty = (version: string) =>
	KITTY_OK + `${ESC}[?1016;2$y` + `${ESC}[?2026;2$y` + `${ESC}[?0u` + `${ESC}[6;36;17t` + xtversion(`ghostty ${version}`) + `${ESC}[?62;22;52c`;
const KITTY = KITTY_OK + `${ESC}[?1016;2$y` + `${ESC}[?2026;2$y` + `${ESC}[?0u` + `${ESC}[6;34;16t` + xtversion('kitty(0.39.1)') + `${ESC}[?62;c`;
const WEZTERM = KITTY_OK + `${ESC}[?2026;2$y` + `${ESC}[6;32;16t` + xtversion('WezTerm 20240203-110809-5046fc22') + `${ESC}[?65;4;6;18;22c`;
// tmux answers XTVERSION and DA1 itself and does not pass the kitty query on.
const TMUX = `${ESC}[?2026;2$y` + xtversion('tmux 3.5a') + `${ESC}[?1;2;4c`;
const TMUX_ENV = {TMUX: '/private/tmp/tmux-501/default,4242,0'};

test('Ghostty 1.3.1: kitty graphics detected but opt-in, terminal name and version parsed', () => {
	const caps = capsFromReplies(ghostty('1.3.1'), {COLORTERM: 'truecolor'});
	expect(caps.terminal).toEqual({name: 'ghostty', version: '1.3.1'});
	expect(caps.kittyGraphicsDetected).toBe(true);
	expect(caps.graphics).toBe('none');
	expect(caps.sixelDetected).toBe(false);
	expect(caps.cell).toEqual({w: 17, h: 36});
	expect(caps.syncOutput).toBe(true);
	expect(capsFromReplies(ghostty('1.3.1'), {GUI_GRAPHICS: 'kitty'}).graphics).toBe('kitty');
});

test('Ghostty 1.4.0 and later, dev and tip builds included, get kitty graphics automatically', () => {
	for (const version of ['1.4.0-dev', '1.4.0-dev+7f2e1a9', '1.4.0-main+0123abc', '1.4.0', '1.4.2', '1.5.0-dev+abc', '2.0.0']) {
		expect(capsFromReplies(ghostty(version), {}).graphics).toBe('kitty');
	}
	for (const version of ['1.3.1', '1.3.9', '1.2.0', 'not-a-version', '']) {
		expect(capsFromReplies(ghostty(version), {}).graphics).toBe('none');
	}
	expect(capsFromReplies(ghostty('1.4.0-dev'), {GUI_GRAPHICS: 'none'}).graphics).toBe('none');
});

test('kitty 0.39 gets kitty graphics automatically; GUI_GRAPHICS=none turns them off', () => {
	const caps = capsFromReplies(KITTY, {});
	expect(caps.terminal).toEqual({name: 'kitty', version: '0.39.1'});
	expect(caps.graphics).toBe('kitty');
	expect(caps.sixelDetected).toBe(false);
	expect(capsFromReplies(KITTY, {GUI_GRAPHICS: 'none'}).graphics).toBe('none');
	expect(capsFromReplies(KITTY, {GUI_GRAPHICS: 'sixel'}).graphics).toBe('none');
});

test('WezTerm: sixel detected but opt-in, kitty only when forced', () => {
	const caps = capsFromReplies(WEZTERM, {});
	expect(caps.terminal).toEqual({name: 'WezTerm', version: '20240203-110809-5046fc22'});
	expect(caps.sixelDetected).toBe(true);
	expect(caps.graphics).toBe('none');
	expect(capsFromReplies(WEZTERM, {GUI_GRAPHICS: 'sixel'}).graphics).toBe('sixel');
	expect(capsFromReplies(WEZTERM, {GUI_GRAPHICS: 'kitty'}).graphics).toBe('kitty');
	// Sixel needs the cell size to match pixels to cells.
	expect(capsFromReplies(WEZTERM.replace(`${ESC}[6;32;16t`, ''), {GUI_GRAPHICS: 'sixel'}).graphics).toBe('none');
});

test('tmux: no kitty graphics, even forced or with a reply that leaked through', () => {
	const caps = capsFromReplies(TMUX, TMUX_ENV);
	expect(caps.inTmux).toBe(true);
	expect(caps.terminal).toEqual({name: 'tmux', version: '3.5a'});
	expect(caps.kittyGraphicsDetected).toBe(false);
	expect(caps.graphics).toBe('none');
	expect(caps.sixelDetected).toBe(true);
	expect(capsFromReplies(ghostty('1.4.0'), TMUX_ENV).graphics).toBe('none');
	expect(capsFromReplies(ghostty('1.4.0'), {...TMUX_ENV, GUI_GRAPHICS: 'kitty'}).graphics).toBe('none');
	// tmux names itself, so Ghostty behind it is not recognized even without $TMUX (e.g. over ssh).
	expect(capsFromReplies(KITTY_OK + xtversion('tmux 3.5a') + `${ESC}[?1;2c`, {}).graphics).toBe('none');
});

test('no reply at all: text only, nothing detected', () => {
	const caps = capsFromReplies('', {});
	expect(caps).toMatchObject({graphics: 'none', kittyGraphicsDetected: false, sixelDetected: false, terminal: undefined, cell: undefined, syncOutput: false});
	expect(capsFromReplies('', {GUI_GRAPHICS: 'kitty'}).graphics).toBe('none');
	expect(capsFromReplies('', {GUI_GRAPHICS: 'sixel'}).graphics).toBe('none');
});

test('other XTVERSION spellings', () => {
	expect(capsFromReplies(xtversion('XTerm(390)') + `${ESC}[?64;1;2;4;6;9;15;18;21;22c`, {}).terminal).toEqual({name: 'XTerm', version: '390'});
	expect(capsFromReplies(xtversion('foot(1.17.2)'), {}).terminal).toEqual({name: 'foot', version: '1.17.2'});
	expect(capsFromReplies(xtversion('iTerm2 3.5.0'), {}).terminal).toEqual({name: 'iTerm2', version: '3.5.0'});
	expect(capsFromReplies(`${ESC}P>|ghostty 1.4.0\u0007`, {}).terminal).toEqual({name: 'ghostty', version: '1.4.0'});
});

test('probe asks XTVERSION before DA1 and reads a split reply', async () => {
	expect(PROBE_QUERIES.indexOf(`${ESC}[>0q`)).toBeGreaterThan(-1);
	expect(PROBE_QUERIES.indexOf(`${ESC}[>0q`)).toBeLessThan(PROBE_QUERIES.indexOf(`${ESC}[c`));
	expect(PROBE_QUERIES.endsWith(`${ESC}[c`)).toBe(true);
	const stdin = Object.assign(new EventEmitter(), {isTTY: true, setRawMode() {}, resume() {}, pause() {}});
	let asked = '';
	const reply = ghostty('1.4.0-dev+abc');
	const stdout = {
		isTTY: true,
		write(data: string) {
			asked += data;
			// The reply arrives in two chunks, cut inside the XTVERSION string.
			const cut = reply.indexOf('1.4.0');
			setTimeout(() => stdin.emit('data', Buffer.from(reply.slice(0, cut))), 1);
			setTimeout(() => stdin.emit('data', Buffer.from(reply.slice(cut))), 3);
			return true;
		},
	};
	const caps = await probe(stdin as unknown as NodeJS.ReadStream, stdout as unknown as NodeJS.WriteStream, 1000);
	expect(asked).toBe(PROBE_QUERIES);
	expect(caps.terminal).toEqual({name: 'ghostty', version: '1.4.0-dev+abc'});
	expect(caps.kittyGraphicsDetected).toBe(true);
});

test('DECRPM: only set, reset and permanently set count; permanently reset (4) and unknown (0) do not', () => {
	const cell = `${ESC}[6;34;16t`;
	for (const value of ['1', '2', '3']) {
		const caps = capsFromReplies(`${ESC}[?1016;${value}$y${ESC}[?2026;${value}$y${cell}`, {});
		expect([caps.sgrPixels, caps.syncOutput]).toEqual([true, true]);
	}
	for (const value of ['0', '4']) {
		const caps = capsFromReplies(`${ESC}[?1016;${value}$y${ESC}[?2026;${value}$y${cell}`, {});
		expect([caps.sgrPixels, caps.syncOutput]).toEqual([false, false]);
	}
});

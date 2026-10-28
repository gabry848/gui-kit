// Asks the terminal what it supports before Ink takes over stdin.
// Every terminal answers DA1, so its reply ends the probe; anything that
// did not answer before it is treated as unsupported. Raw mode stays on
// afterwards, so a late reply is never echoed onto the screen, and
// InputSplitter (input.ts) drops it, so it never reaches the app as keys.

export type Caps = {
	/**
	 * How images and pixel canvases are drawn.
	 * - 'kitty': kitty Unicode placeholders with PNG payloads. On by default
	 *   when the terminal answered the kitty graphics query outside tmux and
	 *   XTVERSION names kitty, or Ghostty 1.4.0 or later (dev and tip builds
	 *   included). Ghostty 1.3.x crashed on zlib payloads
	 *   (bench/ghostty-zlib-crash.md), so there it stays opt-in.
	 * - 'sixel': opt-in only (GUI_GRAPHICS=sixel), and only when DA1 listed
	 *   sixel and the cell size is known.
	 * - 'none': text only (braille and half blocks).
	 * GUI_GRAPHICS=kitty or =sixel turns a protocol on wherever the terminal
	 * reported it; GUI_GRAPHICS=none forces text.
	 */
	graphics: 'kitty' | 'sixel' | 'none';
	/** The terminal answered the kitty graphics query (never inside tmux). */
	kittyGraphicsDetected: boolean;
	/** DA1 listed sixel graphics (attribute 4). */
	sixelDetected: boolean;
	/** Name and version from XTVERSION, e.g. {name: 'ghostty', version: '1.3.1'}. */
	terminal: {name: string; version: string} | undefined;
	truecolor: boolean;
	/** Mouse reports in pixels (DEC mode 1016). */
	sgrPixels: boolean;
	/** Synchronized output (DEC mode 2026). */
	syncOutput: boolean;
	/** Kitty keyboard protocol, which tells Esc apart from Alt and Tab from Ctrl-i. */
	kittyKeyboard: boolean;
	/** Size of one cell in pixels, when the terminal reports it. */
	cell: {w: number; h: number} | undefined;
	inTmux: boolean;
};

const KITTY_QUERY = '\u001B_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\u001B\\';
const XTVERSION = '\u001B[>0q';
/** Everything the probe asks, DA1 last. */
export const PROBE_QUERIES = KITTY_QUERY + '\u001B[?1016$p' + '\u001B[?2026$p' + '\u001B[?u' + '\u001B[16t' + XTVERSION + '\u001B[c';

/** "kitty(0.39.1)", "ghostty 1.3.1", "WezTerm 20240203-110809-5046fc22". */
function parseTerminal(text: string): Caps['terminal'] {
	const match = /^\s*([^\s(]+)\s*(?:\(([^)]*)\)|(\S.*?))?\s*$/.exec(text);
	return match ? {name: match[1]!, version: (match[2] ?? match[3] ?? '').trim()} : undefined;
}

/** Terminals where kitty graphics are known to work with the kit. */
function kittyByDefault(terminal: Caps['terminal']): boolean {
	const name = terminal?.name.toLowerCase();
	if (name === 'kitty') return true;
	if (name !== 'ghostty') return false;
	try {
		// 1.4.0-0 is the lowest 1.4.0 prerelease, so 1.4.0-dev builds pass too.
		return Bun.semver.order(terminal!.version, '1.4.0-0') >= 0;
	} catch {
		return false;
	}
}

export function capsFromReplies(replies: string, env: NodeJS.ProcessEnv): Caps {
	const inTmux = Boolean(env['TMUX']);
	// DECRPM: 1 set, 2 reset, 3 permanently set; 0 unknown and 4 permanently reset cannot be used.
	const mode = (n: number) => {
		const match = new RegExp(`\\u001B\\[\\?${n};(\\d)\\$y`).exec(replies);
		return match ? ['1', '2', '3'].includes(match[1]!) : false;
	};
	const cellMatch = /\u001B\[6;(\d+);(\d+)t/.exec(replies);
	const cell = cellMatch ? {h: Number(cellMatch[1]), w: Number(cellMatch[2])} : undefined;
	const kittyGraphicsDetected = /\u001B_Gi=31;OK/.test(replies) && !inTmux;
	const version = /\u001BP>\|([^\u001B\u0007]*)(?:\u001B\\|\u0007)/.exec(replies);
	const terminal = version ? parseTerminal(version[1]!) : undefined;
	// DA1: the first parameter is the device class, the rest are features.
	const da1 = /\u001B\[\?([\d;]*)c/.exec(replies);
	const sixelDetected = (da1?.[1] ?? '').split(';').slice(1).includes('4');
	const wanted = env['GUI_GRAPHICS'];
	let graphics: Caps['graphics'] = 'none';
	if (wanted === 'kitty') graphics = kittyGraphicsDetected ? 'kitty' : 'none';
	else if (wanted === 'sixel') graphics = sixelDetected && cell ? 'sixel' : 'none';
	else if (wanted !== 'none' && kittyGraphicsDetected && kittyByDefault(terminal)) graphics = 'kitty';
	return {
		graphics,
		kittyGraphicsDetected,
		sixelDetected,
		terminal,
		truecolor: /truecolor|24bit/i.test(env['COLORTERM'] ?? '') || kittyGraphicsDetected,
		// Pixel reports are only usable when the cell size is known.
		sgrPixels: mode(1016) && cell !== undefined && env['GUI_MOUSE_PIXELS'] !== '0',
		syncOutput: mode(2026),
		kittyKeyboard: /\u001B\[\?\d+u/.test(replies),
		cell,
		inTmux,
	};
}

export async function probe(
	stdin: NodeJS.ReadStream = process.stdin,
	stdout: NodeJS.WriteStream = process.stdout,
	timeoutMs = 500,
): Promise<Caps> {
	if (!stdin.isTTY || !stdout.isTTY) {
		return capsFromReplies('', process.env);
	}

	const replies = await new Promise<string>(resolve => {
		let buffer = '';
		const finish = () => {
			clearTimeout(timer);
			stdin.removeListener('data', onData);
			stdin.pause();
			resolve(buffer);
		};
		const onData = (chunk: Buffer) => {
			buffer += chunk.toString('utf8');
			if (/\u001B\[\?[\d;]*c/.test(buffer)) {
				finish();
			}
		};
		const timer = setTimeout(finish, timeoutMs);
		stdin.setRawMode(true);
		stdin.on('data', onData);
		stdin.resume();
		stdout.write(PROBE_QUERIES);
	});

	return capsFromReplies(replies, process.env);
}

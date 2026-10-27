// Asks the terminal what it supports before Ink takes over stdin.
// Every terminal answers DA1, so its reply ends the probe; anything that
// did not answer before it is treated as unsupported. Raw mode stays on
// afterwards, so a late reply is never echoed onto the screen.

export type Caps = {
	/**
	 * Pixel graphics through kitty Unicode placeholders. Opt-in with
	 * GUI_GRAPHICS=kitty while it gets more use: its first version crashed
	 * Ghostty 1.3.1 (zlib payloads, see bench/ghostty-zlib-crash.md).
	 */
	graphics: 'kitty' | 'none';
	/** The terminal answered the kitty graphics query. */
	kittyGraphicsDetected: boolean;
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
const QUERIES = KITTY_QUERY + '\u001B[?1016$p' + '\u001B[?2026$p' + '\u001B[?u' + '\u001B[16t' + '\u001B[c';

export function capsFromReplies(replies: string, env: NodeJS.ProcessEnv): Caps {
	const inTmux = Boolean(env['TMUX']);
	const mode = (n: number) => {
		const match = new RegExp(`\\u001B\\[\\?${n};(\\d)\\$y`).exec(replies);
		return match ? ['1', '2', '3', '4'].includes(match[1]!) : false;
	};
	const cellMatch = /\u001B\[6;(\d+);(\d+)t/.exec(replies);
	const kittyGraphicsDetected = /\u001B_Gi=31;OK/.test(replies) && !inTmux;
	return {
		graphics: kittyGraphicsDetected && env['GUI_GRAPHICS'] === 'kitty' ? 'kitty' : 'none',
		kittyGraphicsDetected,
		truecolor: /truecolor|24bit/i.test(env['COLORTERM'] ?? '') || kittyGraphicsDetected,
		sgrPixels: mode(1016) && env['GUI_MOUSE_PIXELS'] !== '0',
		syncOutput: mode(2026),
		kittyKeyboard: /\u001B\[\?\d+u/.test(replies),
		cell: cellMatch ? {h: Number(cellMatch[1]), w: Number(cellMatch[2])} : undefined,
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
		stdout.write(QUERIES);
	});

	return capsFromReplies(replies, process.env);
}

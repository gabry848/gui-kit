// Ink 8 drops mouse reports before they reach useInput, so the kit reads
// stdin first: it takes the SGR mouse reports out and hands Ink the rest
// through a stream that looks like a tty. It reads with 'data' events:
// under Bun, 'readable' stops firing once the probe has paused stdin.
//
// It also drops the terminal's replies to the probe's queries (probe.ts).
// They reach stdin when the terminal answers after the probe gave up, e.g.
// over a slow ssh link, and Ink would read them as keys ("Gi=31;OK" types
// G, i...). Only complete replies are dropped, and no key sends one: a lone
// ESC P or ESC _ is Alt+P or Alt+_.

import {EventEmitter} from 'node:events';

const REPORT = /\u001B\[<\d+;\d+;\d+[Mm]/g;
// Kitty graphics (APC G ... ST), XTVERSION (DCS >| ... ST or BEL), DA1
// (CSI ? ... c), DECRPM (CSI ? ... $ y), kitty keyboard flags (CSI ? n u)
// and cell size (CSI 6 ; h ; w t).
const REPLY = /\u001B_G[^\u001B]*\u001B\\|\u001BP>\|[^\u001B\u0007]*(?:\u001B\\|\u0007)|\u001B\[\?[\d;]*(?:c|\$y|u)|\u001B\[6;\d+;\d+t/g;
// The tail of a chunk that may be the start of a report or a reply split across chunks.
const PARTIAL = /\u001B(?:\[(?:<[\d;]*|\?[\d;]*\$?|6(?:;\d*){0,2})?|_(?:G[^\u001B]*\u001B?)?|P(?:>(?:\|[^\u001B\u0007]*\u001B?)?)?)?$/;

type Source = NodeJS.ReadableStream & {
	isTTY?: boolean;
	setRawMode?: (mode: boolean) => unknown;
	ref?: () => unknown;
	unref?: () => unknown;
};

export class InputSplitter extends EventEmitter {
	readonly isTTY: boolean;
	private queue: string[] = [];
	private carry = '';
	private flushTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly source: Source) {
		super();
		this.isTTY = source.isTTY ?? false;
		source.on('data', (chunk: string | Buffer) => this.accept(chunk.toString()));
		source.resume();
	}

	private accept(chunk: string) {
		clearTimeout(this.flushTimer);
		const raw = this.carry + chunk;
		let data = raw
			.replace(REPORT, report => {
				this.emit('mouse', report);
				return '';
			})
			.replace(REPLY, reply => {
				this.emit('reply', reply);
				return '';
			});
		this.carry = '';
		const partial = PARTIAL.exec(data);
		// A chunk that is only ESC is the Esc key, so it goes on at once; an
		// ESC that ends a longer chunk may start a sequence cut in two.
		if (partial && (partial[0].length > 1 || raw.length > 1)) {
			this.carry = partial[0];
			data = data.slice(0, partial.index);
			// Not a report or a reply after all: give it to Ink shortly.
			this.flushTimer = setTimeout(() => {
				const rest = this.carry;
				this.carry = '';
				this.pass(rest);
			}, 30);
		}
		this.pass(data);
	}

	private pass(data: string) {
		if (data) {
			this.queue.push(data);
			this.emit('readable');
		}
	}

	read(): string | null {
		return this.queue.shift() ?? null;
	}

	setRawMode(mode: boolean) {
		this.source.setRawMode?.(mode);
		return this;
	}

	setEncoding() {
		return this;
	}

	resume() {
		this.source.resume();
		return this;
	}

	pause() {
		this.source.pause();
		return this;
	}

	ref() {
		this.source.ref?.();
		return this;
	}

	unref() {
		this.source.unref?.();
		return this;
	}
}

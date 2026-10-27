// Ink 8 drops mouse reports before they reach useInput, so the kit reads
// stdin first: it takes the SGR mouse reports out and hands Ink the rest
// through a stream that looks like a tty. It reads with 'data' events:
// under Bun, 'readable' stops firing once the probe has paused stdin.

import {EventEmitter} from 'node:events';

const REPORT = /\u001B\[<\d+;\d+;\d+[Mm]/g;
// The tail of a chunk that may be the start of a report split across chunks.
const PARTIAL = /\u001B(?:\[(?:<[\d;]*)?)?$/;

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
		let data = (this.carry + chunk).replace(REPORT, report => {
			this.emit('mouse', report);
			return '';
		});
		this.carry = '';
		const partial = PARTIAL.exec(data);
		if (partial && partial[0].length > 1) {
			this.carry = partial[0];
			data = data.slice(0, partial.index);
			// Not a report after all: give it to Ink shortly.
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

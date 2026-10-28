// Vim-style key engine: modes, counts, multi-key sequences and layered
// bindings. It knows nothing about React or the terminal, so tests can drive
// it with plain tokens.

export type Mode = 'normal' | 'insert' | 'command';

export type Binding = {
	/** Vim notation: `j`, `gg`, `<C-d>`, `<Space>f`, `<Esc>`. */
	keys: string;
	desc: string;
	group?: string;
	/** Defaults to normal. */
	mode?: Mode;
	run: (count: number) => void;
};

export type Layer = {
	id: number;
	bindings: Binding[];
	/** A modal layer hides every layer below it. */
	modal: boolean;
	/** Higher layers win; same priority, the newest wins. Modals default to 10, the shell uses -10. */
	priority: number;
	/** Receives text in insert mode. */
	onText?: (token: string) => void;
};

export type KeymapState = {
	mode: Mode;
	pending: string[];
	count: number;
	/** Bindings that can follow the pending keys, for the which-key popup. */
	next: Binding[];
	cmdline: {prefix: ':' | '/'; text: string} | undefined;
	message: string;
};

type Listener = (state: KeymapState) => void;

export type CommandHandler = (args: string) => void;

const SPECIAL = /^<[^>]+>/;

/** Key names the kit produces; anything else in angle brackets can never fire. */
const KEY_NAMES = new Set(['<CR>', '<Esc>', '<Tab>', '<S-Tab>', '<BS>', '<Del>', '<Up>', '<Down>', '<Left>', '<Right>', '<PageUp>', '<PageDown>', '<Home>', '<End>', '<Space>']);

/** Throws on a misspelled key name such as `<Enter>` or `<C-D>`, which would otherwise fail silently. */
export function checkKeys(keys: string) {
	for (const token of tokenize(keys)) {
		if (!token.startsWith('<') || token.length === 1) continue;
		if (KEY_NAMES.has(token) || /^<C-[a-z]>$/.test(token) || /^<M-.>$/u.test(token)) continue;
		throw new Error(`Unknown key ${token} in "${keys}": use ${[...KEY_NAMES].join(' ')}, <C-x> with a lowercase letter, or <M-x>`);
	}
}

export function tokenize(keys: string): string[] {
	const tokens: string[] = [];
	let rest = keys;
	while (rest.length > 0) {
		const special = SPECIAL.exec(rest);
		const token = special ? special[0] : [...rest][0]!;
		tokens.push(token);
		rest = rest.slice(token.length);
	}
	return tokens;
}

export class Keymap {
	private layers: Layer[] = [];
	private nextId = 1;
	private commands = new Map<string, {desc: string; run: CommandHandler}>();
	// The newest search handler wins; closing a Modal hands `/` back to the list below.
	private searchHandlers: ((query: string, live: boolean) => void)[] = [];
	private get searchHandler() {
		return this.searchHandlers.at(-1);
	}
	private timer: ReturnType<typeof setTimeout> | undefined;
	private listeners = new Set<Listener>();
	state: KeymapState = {mode: 'normal', pending: [], count: 0, next: [], cmdline: undefined, message: ''};

	constructor(private readonly sequenceTimeoutMs = 700) {}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	addLayer(layer: Omit<Layer, 'id'>): Layer {
		for (const binding of layer.bindings) checkKeys(binding.keys);
		const added = {...layer, id: this.nextId++};
		this.layers.push(added);
		this.layers.sort((a, b) => a.priority - b.priority || a.id - b.id);
		return added;
	}

	removeLayer(id: number) {
		this.layers = this.layers.filter(layer => layer.id !== id);
	}

	updateLayer(id: number, patch: Partial<Omit<Layer, 'id'>>) {
		this.layers = this.layers.map(layer => (layer.id === id ? {...layer, ...patch} : layer));
	}

	command(name: string, desc: string, run: CommandHandler): () => void {
		this.commands.set(name, {desc, run});
		return () => this.commands.delete(name);
	}

	listCommands() {
		return [...this.commands].map(([name, {desc}]) => ({name, desc}));
	}

	/** Receives `/` searches until the returned function is called. */
	onSearch(handler: (query: string, live: boolean) => void): () => void {
		this.searchHandlers.push(handler);
		return () => {
			this.searchHandlers = this.searchHandlers.filter(other => other !== handler);
		};
	}

	/** Bindings visible right now, topmost layer first, later layers win. */
	active(mode: Mode = this.state.mode): Binding[] {
		const visible: Layer[] = [];
		for (let index = this.layers.length - 1; index >= 0; index--) {
			visible.push(this.layers[index]!);
			if (this.layers[index]!.modal) {
				break;
			}
		}
		const seen = new Set<string>();
		const result: Binding[] = [];
		for (const layer of visible) {
			for (const binding of layer.bindings) {
				if ((binding.mode ?? 'normal') !== mode || seen.has(binding.keys)) {
					continue;
				}
				seen.add(binding.keys);
				result.push(binding);
			}
		}
		return result;
	}

	setMode(mode: Mode) {
		this.set({mode, pending: [], count: 0, next: []});
	}

	flash(message: string) {
		this.set({message});
	}

	openCmdline(prefix: ':' | '/') {
		this.set({mode: 'command', cmdline: {prefix, text: ''}, pending: [], next: []});
	}

	feed(token: string) {
		const {mode} = this.state;
		if (mode === 'command') {
			this.feedCmdline(token);
			return;
		}
		if (mode === 'insert') {
			if (token === '<Esc>') {
				this.setMode('normal');
				return;
			}
			const insertBinding = this.active('insert').find(binding => binding.keys === token);
			if (insertBinding) {
				insertBinding.run(1);
				return;
			}
			// Space is text; any other named key without a binding (Tab, arrows,
			// Ctrl-x) is dropped rather than typed as "<Tab>".
			if (token === '<Space>') {
				this.textTarget()?.onText?.(' ');
			} else if (!SPECIAL.test(token)) {
				this.textTarget()?.onText?.(token);
			}
			return;
		}
		this.feedNormal(token);
	}

	/** Literal text typed in insert mode, never read as a key name such as `<CR>`. */
	insertText(text: string) {
		if (this.state.mode === 'insert') {
			this.textTarget()?.onText?.(text);
			return;
		}
		for (const char of text) this.feed(char === ' ' ? '<Space>' : char);
	}

	private textTarget(): Layer | undefined {
		for (let index = this.layers.length - 1; index >= 0; index--) {
			if (this.layers[index]!.onText) {
				return this.layers[index];
			}
			if (this.layers[index]!.modal) {
				return undefined;
			}
		}
		return undefined;
	}

	private feedNormal(token: string) {
		clearTimeout(this.timer);
		const {pending, count} = this.state;
		// A digit is a count, unless the app binds keys that start with it and no
		// count is being typed: then `1` can be a key of its own.
		const digitIsKey = count === 0 && this.active().some(binding => tokenize(binding.keys)[0] === token);
		if (pending.length === 0 && /^[0-9]$/.test(token) && (token !== '0' || count > 0) && !digitIsKey) {
			this.set({count: count * 10 + Number(token), message: ''});
			return;
		}
		if (pending.length > 0 && token === '<Esc>') {
			this.set({pending: [], count: 0, next: [], message: ''});
			return;
		}
		if (pending.length === 0 && token === '<Esc>') {
			this.set({count: 0, message: ''});
			// Fall through so overlays can bind <Esc>.
		}
		const sequence = [...pending, token];
		const bindings = this.active();
		const matches = bindings.filter(binding => startsWith(tokenize(binding.keys), sequence));
		const exact = matches.find(binding => tokenize(binding.keys).length === sequence.length);
		const longer = matches.filter(binding => tokenize(binding.keys).length > sequence.length);

		if (exact && longer.length === 0) {
			this.runBinding(exact);
			return;
		}
		if (matches.length === 0) {
			if (pending.length > 0) {
				// The new key does not continue the sequence: run what was typed if it
				// is a command itself (as Vim does), then take the key on its own.
				const done = bindings.find(binding => tokenize(binding.keys).length === pending.length && startsWith(tokenize(binding.keys), pending));
				if (done) this.runBinding(done);
				else this.set({pending: [], next: []});
				this.feedNormal(token);
				return;
			}
			this.set({pending: [], count: 0, next: [], message: token === '<Esc>' ? '' : `No command: ${sequence.join('')}`});
			return;
		}
		this.set({pending: sequence, next: longer, message: ''});
		if (exact) {
			this.timer = setTimeout(() => this.runBinding(exact), this.sequenceTimeoutMs);
		}
	}

	private runBinding(binding: Binding) {
		const count = Math.max(1, this.state.count);
		this.set({pending: [], count: 0, next: [], message: ''});
		binding.run(count);
	}

	private feedCmdline(token: string) {
		const cmdline = this.state.cmdline;
		if (!cmdline) {
			this.setMode('normal');
			return;
		}
		if (token === '<Esc>') {
			if (cmdline.prefix === '/') {
				this.searchHandler?.('', true);
			}
			this.set({mode: 'normal', cmdline: undefined});
			return;
		}
		if (token === '<CR>') {
			this.set({mode: 'normal', cmdline: undefined});
			if (cmdline.prefix === '/') {
				this.searchHandler?.(cmdline.text, false);
			} else {
				this.execute(cmdline.text);
			}
			return;
		}
		let text = cmdline.text;
		if (token === '<BS>') {
			if (text.length === 0) {
				this.set({mode: 'normal', cmdline: undefined});
				return;
			}
			text = text.slice(0, -1);
		} else if (token === '<Space>') {
			text += ' ';
		} else if (!token.startsWith('<')) {
			text += token;
		}
		this.set({cmdline: {...cmdline, text}});
		if (cmdline.prefix === '/') {
			this.searchHandler?.(text, true);
		}
	}

	execute(line: string) {
		const [name = '', ...rest] = line.trim().split(/\s+/);
		if (name === '') {
			return;
		}
		const command = this.commands.get(name);
		if (!command) {
			this.flash(`Unknown command: ${name}`);
			return;
		}
		command.run(rest.join(' '));
	}

	private set(patch: Partial<KeymapState>) {
		this.state = {...this.state, ...patch};
		for (const listener of this.listeners) {
			listener(this.state);
		}
	}
}

function startsWith(keys: string[], prefix: string[]): boolean {
	return prefix.length <= keys.length && prefix.every((token, index) => keys[index] === token);
}

type InkKey = {
	upArrow: boolean;
	downArrow: boolean;
	leftArrow: boolean;
	rightArrow: boolean;
	pageDown: boolean;
	pageUp: boolean;
	home: boolean;
	end: boolean;
	return: boolean;
	escape: boolean;
	ctrl: boolean;
	shift: boolean;
	tab: boolean;
	backspace: boolean;
	delete: boolean;
	meta: boolean;
};

/** Turns one Ink keypress into a token of the notation above. */
export function tokenFromInk(input: string, key: InkKey): string | undefined {
	if (key.escape) return '<Esc>';
	if (key.return) return '<CR>';
	if (key.tab) return key.shift ? '<S-Tab>' : '<Tab>';
	if (key.backspace) return '<BS>';
	if (key.delete) return '<Del>';
	if (key.upArrow) return '<Up>';
	if (key.downArrow) return '<Down>';
	if (key.leftArrow) return '<Left>';
	if (key.rightArrow) return '<Right>';
	if (key.pageUp) return '<PageUp>';
	if (key.pageDown) return '<PageDown>';
	if (key.home) return '<Home>';
	if (key.end) return '<End>';
	if (input === '') return undefined;
	if (key.ctrl) return `<C-${input.toLowerCase()}>`;
	if (key.meta) return `<M-${input}>`;
	if (input === ' ') return '<Space>';
	return input;
}

/** Readable form of a key sequence for help and status lines. */
export function prettyKeys(keys: string): string {
	const names: Record<string, string> = {'<Space>': '␣', '<CR>': '⏎', '<Esc>': 'Esc', '<Tab>': 'Tab', '<S-Tab>': 'S-Tab'};
	return tokenize(keys)
		.map(token => names[token] ?? (token.startsWith('<C-') ? `Ctrl-${token.slice(3, -1)} ` : token))
		.join('')
		.trim();
}

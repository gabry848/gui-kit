import {createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode} from 'react';
import {useApp, useInput, useStdout} from 'ink';
import {Keymap, tokenFromInk, type Binding, type KeymapState} from './keymap.js';
import type {InputSplitter} from './input.js';
import {parseMouse, type MouseEvent} from './mouse.js';
import type {Caps} from './probe.js';

type MouseHandler = (event: MouseEvent) => void;

type Kit = {
	keymap: Keymap;
	caps: Caps;
	/** Raw terminal output for things Ink does not draw, such as image data. */
	write: (data: string) => void;
	addMouse: (handler: MouseHandler) => () => void;
	/** Open overlays such as help, so the shell can draw them. */
	overlay: string | undefined;
	setOverlay: (overlay: string | undefined) => void;
	/** Ends the app with a result; `gui ask` prints it as JSON. */
	finish: (value: unknown) => void;
};

const KitContext = createContext<Kit | undefined>(undefined);

export function useKit(): Kit {
	const kit = useContext(KitContext);
	if (!kit) {
		throw new Error('useKit needs <KitProvider>');
	}
	return kit;
}

type ProviderProps = {
	caps: Caps;
	input: InputSplitter;
	onFinish?: (value: unknown) => void;
	children: ReactNode;
};

export function KitProvider({caps, input, onFinish, children}: ProviderProps) {
	const {exit} = useApp();
	const {write} = useStdout();
	const keymapRef = useRef<Keymap>(undefined);
	keymapRef.current ??= new Keymap();
	const keymap = keymapRef.current;
	const mouseHandlers = useRef(new Set<MouseHandler>());
	const [overlay, setOverlay] = useState<string | undefined>();

	useEffect(() => keymap.command('q', 'Chiudi l\'app', () => exit()), [keymap, exit]);
	useEffect(() => keymap.command('quit', 'Chiudi l\'app', () => exit()), [keymap, exit]);

	useEffect(() => {
		const onMouse = (report: string) => {
			const mouse = parseMouse(report, caps.sgrPixels ? caps.cell : undefined);
			if (mouse) {
				for (const handler of [...mouseHandlers.current].reverse()) {
					handler(mouse);
				}
			}
		};
		input.on('mouse', onMouse);
		return () => {
			input.off('mouse', onMouse);
		};
	}, [input, caps]);

	// Text typed faster than it is read, or sent by an agent, arrives as one
	// chunk; Ink only splits escape sequences, so Enter and Tab ride along too.
	// The chunk is fed one key at a time, each after the previous one has been
	// rendered, so handlers see current state. Outside insert mode every
	// character is a key; in insert mode a run of text goes in as one piece.
	const pending = useRef<{text?: string; key?: string}[]>([]);
	const pump = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// An exception in a key handler ends the app through Ink, so the terminal
	// is restored and the error reaches waitUntilExit instead of killing Bun.
	const safely = useCallback((step: () => void) => {
		try {
			step();
		} catch (error) {
			pending.current = [];
			exit(error instanceof Error ? error : new Error(String(error)));
		}
	}, [exit]);

	const drain = useCallback(() => {
		pump.current = undefined;
		const next = pending.current[0];
		if (!next) return;
		if (next.key !== undefined) {
			pending.current.shift();
			safely(() => keymap.feed(next.key!));
		} else {
			const text = next.text!;
			const insert = keymap.state.mode === 'insert';
			// Control characters are keys; in insert mode the text between them is one piece.
			const piece = insert ? /^(?:[\u0000-\u001F\u007F]|[^\u0000-\u001F\u007F]+)/u.exec(text)![0] : [...text][0]!;
			const rest = text.slice(piece.length);
			if (rest) next.text = rest;
			else pending.current.shift();
			const key = controlKey(piece);
			if (key) safely(() => keymap.feed(key));
			else if (insert && !/^[\u0000-\u001F\u007F]$/u.test(piece)) safely(() => keymap.insertText(piece));
			else if (piece >= ' ') safely(() => keymap.feed(piece === ' ' ? '<Space>' : piece));
		}
		if (pending.current.length > 0) pump.current = setTimeout(drain, 2);
	}, [keymap, safely]);

	useInput((text, key) => {
		const token = tokenFromInk(text, key);
		if (!token) {
			return;
		}
		// Typed text comes back unchanged from tokenFromInk; key names do not.
		const typed = token === text && !key.ctrl && !key.meta;
		if (!typed || ([...text].length === 1 && text >= ' ')) {
			if (pending.current.length === 0) {
				safely(() => (typed && keymap.state.mode === 'insert' ? keymap.insertText(text) : keymap.feed(token)));
				return;
			}
			pending.current.push(typed ? {text} : {key: token});
		} else {
			pending.current.push({text});
		}
		if (!pump.current) drain();
	});

	const addMouse = useCallback((handler: MouseHandler) => {
		mouseHandlers.current.add(handler);
		return () => {
			mouseHandlers.current.delete(handler);
		};
	}, []);

	const finish = useCallback((value: unknown) => {
		onFinish?.(value);
		exit();
	}, [onFinish, exit]);

	const kit: Kit = {
		keymap,
		caps,
		write,
		addMouse,
		overlay,
		setOverlay,
		finish,
	};

	return <KitContext.Provider value={kit}>{children}</KitContext.Provider>;
}

/** The key name for one control character in a chunk, if it is a key. */
function controlKey(char: string): string | undefined {
	if (char === '\r' || char === '\n') return '<CR>';
	if (char === '\t') return '<Tab>';
	if (char === '\u007F' || char === '\b') return '<BS>';
	const code = char.codePointAt(0)!;
	if (char.length === 1 && code >= 1 && code <= 26) return `<C-${String.fromCharCode(code + 96)}>`;
	return undefined;
}

/**
 * Raises the priority of every useKeys below it. A Modal renders its children
 * inside a higher scope, so the keys of a Form or Confirm it contains sit
 * above the Modal's own modal layer instead of being hidden by it.
 */
export const KeyScope = createContext(0);

/** Ends the app with a result, e.g. the values of a form. */
export function useFinish(): (value: unknown) => void {
	return useKit().finish;
}

export function useKeymapState(): KeymapState {
	const {keymap} = useKit();
	return useSyncExternalStore(
		listener => keymap.subscribe(listener),
		() => keymap.state,
	);
}

type KeyOptions = {
	active?: boolean;
	modal?: boolean;
	priority?: number;
	onText?: (token: string) => void;
};

/**
 * Registers bindings while the component is mounted and `active` is true.
 * Handlers always see the latest props, so callers need no dependency list.
 */
export function useKeys(bindings: Binding[], options: KeyOptions = {}) {
	const {keymap} = useKit();
	const scope = useContext(KeyScope);
	const {active = true, modal = false} = options;
	const priority = scope + (options.priority ?? (modal ? 10 : 0));
	const latest = useRef({bindings, onText: options.onText});
	latest.current = {bindings, onText: options.onText};
	const signature = bindings.map(binding => `${binding.mode ?? 'normal'}:${binding.keys}:${binding.desc}`).join('|');

	useEffect(() => {
		if (!active) {
			return;
		}
		const stable = latest.current.bindings.map((binding, index) => ({
			...binding,
			run: (count: number) => latest.current.bindings[index]?.run(count),
		}));
		const layer = keymap.addLayer({
			bindings: stable,
			modal,
			priority,
			...(latest.current.onText ? {onText: (token: string) => latest.current.onText?.(token)} : {}),
		});
		return () => keymap.removeLayer(layer.id);
	}, [keymap, active, modal, priority, signature]);
}

export function useCommand(name: string, desc: string, run: (args: string) => void) {
	const {keymap} = useKit();
	const latest = useRef(run);
	latest.current = run;
	useEffect(() => keymap.command(name, desc, args => latest.current(args)), [keymap, name, desc]);
}

export function useMouse(handler: MouseHandler, active = true) {
	const {addMouse} = useKit();
	const latest = useRef(handler);
	latest.current = handler;
	useEffect(() => (active ? addMouse(event => latest.current(event)) : undefined), [addMouse, active]);
}

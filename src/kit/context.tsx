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
};

const KitContext = createContext<Kit | undefined>(undefined);

export function useKit(): Kit {
	const kit = useContext(KitContext);
	if (!kit) {
		throw new Error('useKit needs <KitProvider>');
	}
	return kit;
}

export function KitProvider({caps, input, children}: {caps: Caps; input: InputSplitter; children: ReactNode}) {
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

	useInput((text, key) => {
		const token = tokenFromInk(text, key);
		if (!token) {
			return;
		}
		// Text typed faster than it is read arrives as one chunk; outside insert
		// mode every character is its own key.
		const chars = [...token];
		if (chars.length > 1 && !token.startsWith('<') && keymap.state.mode !== 'insert') {
			// Ink only splits escape sequences; Enter and Tab can ride along in the chunk.
			const named: Record<string, string> = {' ': '<Space>', '\r': '<CR>', '\n': '<CR>', '\t': '<Tab>'};
			for (const char of chars) {
				keymap.feed(named[char] ?? char);
			}
			return;
		}
		keymap.feed(token);
	});

	const addMouse = useCallback((handler: MouseHandler) => {
		mouseHandlers.current.add(handler);
		return () => {
			mouseHandlers.current.delete(handler);
		};
	}, []);

	const kit: Kit = {
		keymap,
		caps,
		write,
		addMouse,
		overlay,
		setOverlay,
	};

	return <KitContext.Provider value={kit}>{children}</KitContext.Provider>;
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
	const {active = true, modal = false} = options;
	const priority = options.priority ?? (modal ? 10 : 0);
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

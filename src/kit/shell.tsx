import {createContext, useContext, useEffect, useRef, useState, type ReactNode} from 'react';
import {Box, Text, useApp, useWindowSize, type DOMElement} from 'ink';
import {KeyScope, useCommand, useKeymapState, useKeys, useKit, useMouseBarrier} from './context.js';
import {useGraphicsSuspend} from './graphics.js';
import {prettyKeys, type Binding} from './keymap.js';
import {absolutePosition} from './layout.js';
import {useToasts} from './notify.js';
import {theme} from './theme.js';

const MODE_LABEL = {normal: 'NORMAL', insert: 'INSERT', command: 'COMMAND'} as const;

/**
 * The layer a Modal draws into, through a portal: the Shell's box over the
 * content area (the whole screen but the status line), or inside an open
 * Modal a box drawn after it, for the Modals nested in it. So a Modal opened
 * in a Split pane or a tab is neither moved nor cut by that pane, it stays
 * where it is in the React tree, with its state and the contexts around it,
 * and a nested Modal is always drawn over the one it is in, even when both
 * open in the same commit. null until the layer's box has mounted; undefined
 * outside a Shell, where a Modal draws in place.
 */
const ModalLayer = createContext<DOMElement | null | undefined>(undefined);

// React's portal element, as react-dom's createPortal builds it. Ink's
// reconciler supports portals (appendChildToContainer and the rest work on any
// node) but does not export createPortal.
const PORTAL = Symbol.for('react.portal');
function portal(children: ReactNode, container: DOMElement): ReactNode {
	return {$$typeof: PORTAL, key: null, children, containerInfo: container, implementation: null} as unknown as ReactNode;
}

/** Full-screen frame of every app: content, status line, popups. */
export function Shell({title, hint, children}: {title: string; hint?: string; children: ReactNode}) {
	const {columns, rows} = useWindowSize();
	const {keymap, overlay, setOverlay} = useKit();
	const {exit} = useApp();
	const [layer, setLayer] = useState<DOMElement | null>(null);

	useKeys(
		[
			{keys: ':', desc: 'Command line', group: 'App', run: () => keymap.openCmdline(':')},
			{keys: '?', desc: 'Help: all keys', group: 'App', run: () => setOverlay(overlay === 'help' ? undefined : 'help')},
			{keys: 'q', desc: 'Quit', group: 'App', run: () => exit()},
		],
		{priority: -10},
	);
	useCommand('help', 'Help: all keys', () => setOverlay('help'));

	return (
		<ModalLayer.Provider value={layer}>
			<Box flexDirection="column" width={columns} height={rows}>
				{/* All the rows but the status line, whatever the content draws: content that does not fit is cut, it never pushes the status line out. */}
				<Box flexGrow={1} flexShrink={1} flexBasis={0} minHeight={0} flexDirection="column" overflow="hidden">
					{children}
				</Box>
				{/* Modals draw here: over the content, cut above the status line, under the key menu, the help and the toasts. */}
				<Box ref={setLayer} position="absolute" top={0} left={0} width={columns} height={Math.max(0, rows - 1)} overflow="hidden" />
				<StatusLine title={title} hint={hint} />
				<WhichKey />
				{overlay === 'help' ? <Help onClose={() => setOverlay(undefined)} /> : null}
				<Toasts />
			</Box>
		</ModalLayer.Provider>
	);
}

const TOAST = {
	info: {icon: '•', color: theme.accent},
	success: {icon: '✓', color: theme.success},
	warning: {icon: '!', color: theme.warning},
	error: {icon: '✗', color: theme.danger},
} as const;

// Clicks on a toast go to it before the screen below, but not through an open Modal (20) or the help.
const TOAST_SCOPE = 15;

/**
 * Notifications from useNotify, stacked at the top right. Esc dismisses them
 * all, unless the app binds Esc itself; :dismiss always does, and a click
 * dismisses the toast under it.
 */
function Toasts() {
	const {toasts, dismiss} = useToasts();
	const {columns} = useWindowSize();
	const {addMouse} = useKit();
	const boxes = useRef(new Map<number, DOMElement>());
	useKeys([{keys: '<Esc>', desc: 'Dismiss notifications', group: 'App', run: () => dismiss()}], {active: toasts.length > 0, priority: -10});
	useCommand('dismiss', 'Dismiss notifications', () => dismiss());
	const shown = toasts.length > 0;
	useEffect(() => {
		if (!shown) return;
		return addMouse(event => {
			if (event.kind !== 'down') return false;
			for (const [id, node] of boxes.current) {
				const {x, y} = absolutePosition(node);
				const width = node.yogaNode?.getComputedWidth() ?? 0;
				const height = node.yogaNode?.getComputedHeight() ?? 0;
				if (event.x >= x && event.x < x + width && event.y >= y && event.y < y + height) {
					dismiss(id);
					// The toast covers what is below it, so the click stops here.
					return true;
				}
			}
			return false;
		}, TOAST_SCOPE);
	}, [addMouse, dismiss, shown]);
	// Sixel images are drawn over Ink's text, so they hide while anything floats above them.
	useGraphicsSuspend(shown);
	if (!shown) {
		return null;
	}
	return (
		<Box position="absolute" top={0} right={1} flexDirection="column" alignItems="flex-end">
			{toasts.map(toast => (
				<Box key={toast.id} ref={node => {
					if (node) boxes.current.set(toast.id, node);
					else boxes.current.delete(toast.id);
				}} borderStyle="round" borderColor={TOAST[toast.kind].color} backgroundColor={theme.background} paddingX={1} maxWidth={Math.max(20, Math.floor(columns / 2))}>
					<Text color={TOAST[toast.kind].color}>{TOAST[toast.kind].icon} </Text>
					<Text color={theme.text}>{toast.text}</Text>
				</Box>
			))}
		</Box>
	);
}

function StatusLine({title, hint}: {title: string; hint: string | undefined}) {
	const state = useKeymapState();
	if (state.cmdline) {
		return (
			<Box height={1} flexShrink={0}>
				<Text color={theme.modes.command}>{state.cmdline.prefix}</Text>
				<Text color={theme.text}>{state.cmdline.text}</Text>
				<Text inverse> </Text>
			</Box>
		);
	}
	const pending = (state.count > 0 ? String(state.count) : '') + state.pending.join('');
	return (
		<Box height={1} flexShrink={0} overflow="hidden">
			<Box flexShrink={0}>
				<Text backgroundColor={theme.modes[state.mode]} color={theme.accentText} bold>
					{` ${MODE_LABEL[state.mode]} `}
				</Text>
			</Box>
			<Box flexShrink={1}>
				<Text color={theme.text} wrap="truncate-end"> {title} </Text>
			</Box>
			{state.message ? (
				<Box flexShrink={0}>
					<Text color={theme.warning} wrap="truncate-end"> {state.message}</Text>
				</Box>
			) : null}
			<Box flexGrow={1} />
			{pending ? <Box flexShrink={0}><Text color={theme.accent}>{pending} </Text></Box> : null}
			<Box flexShrink={2}>
				<Text color={theme.muted} wrap="truncate-start">{hint ?? '? help  : commands  q quit'} </Text>
			</Box>
		</Box>
	);
}

/** Shows what can follow the keys typed so far, like which-key in Neovim. */
function WhichKey() {
	const state = useKeymapState();
	const shown = state.pending.length > 0 && state.next.length > 0;
	useGraphicsSuspend(shown);
	if (!shown) {
		return null;
	}
	const typed = state.pending.length;
	return (
		<Box position="absolute" bottom={1} right={1} flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
			{state.next.map(binding => (
				<Box key={binding.keys} gap={2}>
					<Text color={theme.accent}>{prettyKeys(binding.keys.slice(state.pending.join('').length)) || prettyKeys(binding.keys)}</Text>
					<Text color={theme.text}>{binding.desc}</Text>
				</Box>
			)).slice(0, 12)}
			<Text color={theme.muted}>{typed > 0 ? 'Esc cancel' : ''}</Text>
		</Box>
	);
}

function Help({onClose}: {onClose: () => void}) {
	const {keymap} = useKit();
	// Read the keys once, before this modal layer hides them all.
	const [bindings] = useState(() => keymap.active('normal').filter(binding => binding.group !== 'hidden'));
	useKeys(
		[
			{keys: '<Esc>', desc: 'Close help', group: 'hidden', run: onClose},
			{keys: '?', desc: 'Close help', group: 'hidden', run: onClose},
			{keys: 'q', desc: 'Close help', group: 'hidden', run: onClose},
		],
		{modal: true, priority: 1000},
	);
	useMouseBarrier(1000);
	const groups = new Map<string, Binding[]>();
	for (const binding of bindings) {
		const group = binding.group ?? 'Other';
		groups.set(group, [...(groups.get(group) ?? []), binding]);
	}
	const commands = keymap.listCommands();
	return (
		<Overlay title="Help">
			<Box gap={4}>
				<Box flexDirection="column">
					{[...groups].map(([group, list]) => (
						<Box key={group} flexDirection="column" marginBottom={1}>
							<Text bold color={theme.accent}>{group}</Text>
							{list.map(binding => (
								<Box key={binding.keys} gap={2}>
									<Box width={11} flexShrink={0}><Text color={theme.warning}>{prettyKeys(binding.keys)}</Text></Box>
									<Text color={theme.text}>{binding.desc}</Text>
								</Box>
							))}
						</Box>
					))}
				</Box>
				<Box flexDirection="column">
					<Text bold color={theme.accent}>Commands</Text>
					{commands.map(command => (
						<Box key={command.name} gap={2}>
							<Box width={11} flexShrink={0}><Text color={theme.warning}>:{command.name}</Text></Box>
							<Text color={theme.text}>{command.desc}</Text>
						</Box>
					))}
				</Box>
			</Box>
			<Text color={theme.muted}>Esc, ? or q to close</Text>
		</Overlay>
	);
}

/** A bordered box centered over the screen. */
export function Overlay({title, children, width}: {title: string; children: ReactNode; width?: number}) {
	const {columns, rows} = useWindowSize();
	useGraphicsSuspend();
	return (
		<Box position="absolute" width={columns} height={rows} justifyContent="center" alignItems="center">
			<Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={2} paddingY={1} backgroundColor="#16161e" {...(width ? {width} : {})}>
				<Text bold color={theme.accent}>{title}</Text>
				<Box height={1} />
				{children}
			</Box>
		</Box>
	);
}

/**
 * A modal dialog: it takes the keys until it closes. Inside a Shell it is
 * drawn centered over the screen wherever it is rendered, a Split pane or a
 * tab included, and cut above the status line. A Modal inside another one is
 * drawn over it.
 */
export function Modal({title, onClose, bindings = [], children}: {title: string; onClose: () => void; bindings?: Binding[]; children: ReactNode}) {
	useKeys(
		[
			...bindings,
			{keys: '<Esc>', desc: 'Close', group: 'Window', run: onClose},
			{keys: 'q', desc: 'Close', group: 'Window', run: onClose},
		],
		{modal: true},
	);
	// Children's keys go above this modal layer, or a Form inside would get none.
	const scope = useContext(KeyScope);
	useMouseBarrier(scope + 20);
	const layer = useContext(ModalLayer);
	// Modals inside this one draw into a box that comes after its own, so
	// they are on top of it whatever order React mounts them in.
	const [nested, setNested] = useState<DOMElement | null>(null);
	if (layer === undefined) {
		return (
			<KeyScope.Provider value={scope + 20}>
				<Overlay title={title}>{children}</Overlay>
			</KeyScope.Provider>
		);
	}
	const content = (
		<KeyScope.Provider value={scope + 20}>
			<ModalLayer.Provider value={nested}>
				<Overlay title={title}>{children}</Overlay>
			</ModalLayer.Provider>
			<Box ref={setNested} position="absolute" top={0} left={0} width="100%" height="100%" />
		</KeyScope.Provider>
	);
	return layer ? portal(content, layer) : null;
}

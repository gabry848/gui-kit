import {useContext, useState, type ReactNode} from 'react';
import {Box, Text, useApp, useWindowSize} from 'ink';
import {KeyScope, useCommand, useKeymapState, useKeys, useKit, useMouseBarrier} from './context.js';
import {prettyKeys, type Binding} from './keymap.js';
import {theme} from './theme.js';

const MODE_LABEL = {normal: 'NORMAL', insert: 'INSERT', command: 'COMANDO'} as const;

/** Full-screen frame of every app: content, status line, popups. */
export function Shell({title, hint, children}: {title: string; hint?: string; children: ReactNode}) {
	const {columns, rows} = useWindowSize();
	const {keymap, overlay, setOverlay} = useKit();
	const {exit} = useApp();

	useKeys(
		[
			{keys: ':', desc: 'Riga di comando', group: 'App', run: () => keymap.openCmdline(':')},
			{keys: '?', desc: 'Aiuto: tutti i tasti', group: 'App', run: () => setOverlay(overlay === 'help' ? undefined : 'help')},
			{keys: 'q', desc: 'Esci', group: 'App', run: () => exit()},
		],
		{priority: -10},
	);
	useCommand('help', 'Aiuto: tutti i tasti', () => setOverlay('help'));

	return (
		<Box flexDirection="column" width={columns} height={rows}>
			<Box flexGrow={1} flexDirection="column" overflow="hidden">
				{children}
			</Box>
			<StatusLine title={title} hint={hint} />
			<WhichKey />
			{overlay === 'help' ? <Help onClose={() => setOverlay(undefined)} /> : null}
		</Box>
	);
}

function StatusLine({title, hint}: {title: string; hint: string | undefined}) {
	const state = useKeymapState();
	if (state.cmdline) {
		return (
			<Box height={1}>
				<Text color={theme.modes.command}>{state.cmdline.prefix}</Text>
				<Text color={theme.text}>{state.cmdline.text}</Text>
				<Text inverse> </Text>
			</Box>
		);
	}
	const pending = (state.count > 0 ? String(state.count) : '') + state.pending.join('');
	return (
		<Box height={1} overflow="hidden">
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
				<Text color={theme.muted} wrap="truncate-start">{hint ?? '? aiuto  : comandi  q esci'} </Text>
			</Box>
		</Box>
	);
}

/** Shows what can follow the keys typed so far, like which-key in Neovim. */
function WhichKey() {
	const state = useKeymapState();
	if (state.pending.length === 0 || state.next.length === 0) {
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
			<Text color={theme.muted}>{typed > 0 ? 'Esc annulla' : ''}</Text>
		</Box>
	);
}

function Help({onClose}: {onClose: () => void}) {
	const {keymap} = useKit();
	// Read the keys once, before this modal layer hides them all.
	const [bindings] = useState(() => keymap.active('normal').filter(binding => binding.group !== 'hidden'));
	useKeys(
		[
			{keys: '<Esc>', desc: 'Chiudi aiuto', group: 'hidden', run: onClose},
			{keys: '?', desc: 'Chiudi aiuto', group: 'hidden', run: onClose},
			{keys: 'q', desc: 'Chiudi aiuto', group: 'hidden', run: onClose},
		],
		{modal: true, priority: 1000},
	);
	useMouseBarrier(1000);
	const groups = new Map<string, Binding[]>();
	for (const binding of bindings) {
		const group = binding.group ?? 'Altro';
		groups.set(group, [...(groups.get(group) ?? []), binding]);
	}
	const commands = keymap.listCommands();
	return (
		<Overlay title="Aiuto">
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
					<Text bold color={theme.accent}>Comandi</Text>
					{commands.map(command => (
						<Box key={command.name} gap={2}>
							<Box width={11} flexShrink={0}><Text color={theme.warning}>:{command.name}</Text></Box>
							<Text color={theme.text}>{command.desc}</Text>
						</Box>
					))}
				</Box>
			</Box>
			<Text color={theme.muted}>Esc, ? o q per chiudere</Text>
		</Overlay>
	);
}

/** A bordered box centered over the screen. */
export function Overlay({title, children, width}: {title: string; children: ReactNode; width?: number}) {
	const {columns, rows} = useWindowSize();
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

/** A modal dialog: it takes the keys until it closes. */
export function Modal({title, onClose, bindings = [], children}: {title: string; onClose: () => void; bindings?: Binding[]; children: ReactNode}) {
	useKeys(
		[
			...bindings,
			{keys: '<Esc>', desc: 'Chiudi', group: 'Finestra', run: onClose},
			{keys: 'q', desc: 'Chiudi', group: 'Finestra', run: onClose},
		],
		{modal: true},
	);
	// Children's keys go above this modal layer, or a Form inside would get none.
	const scope = useContext(KeyScope);
	useMouseBarrier(scope + 20);
	return (
		<KeyScope.Provider value={scope + 20}>
			<Overlay title={title}>{children}</Overlay>
		</KeyScope.Provider>
	);
}

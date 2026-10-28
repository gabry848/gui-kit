import {useEffect, useRef, useState, type ReactNode} from 'react';
import {Box, Text, type DOMElement} from 'ink';
import {useKeys, useKit, useMouse} from '../context.js';
import {absolutePosition} from '../layout.js';
import {theme} from '../theme.js';

export type Tab = {id: string; title: string; content: ReactNode};

type Props = {
	tabs: Tab[];
	/** The open tab's id. Without it the tabs keep their own, starting from the first. */
	selected?: string;
	onChange?: (id: string) => void;
	active?: boolean;
};

/**
 * A row of tab titles over the open tab's content; the other tabs are not
 * mounted, so their state starts over when they open again. gt and gT move,
 * 3gt opens the third tab, a click on a title opens it.
 */
export function Tabs({tabs, selected, onChange, active = true}: Props) {
	const {keymap} = useKit();
	const [own, setOwn] = useState(tabs[0]?.id);
	const current = Math.max(0, tabs.findIndex(tab => tab.id === (selected ?? own)));
	const titles = useRef<(DOMElement | null)[]>([]);

	const open = (index: number) => {
		const tab = tabs[(index + tabs.length) % tabs.length];
		if (!tab) return;
		setOwn(tab.id);
		onChange?.(tab.id);
	};

	// run() gets at least 1, so `gt` and `1gt` look alike. Vim tells them
	// apart, so remember the count typed before the pending `g`.
	const typedCount = useRef(0);
	useEffect(() => keymap.subscribe(state => {
		if (state.pending.length > 0) typedCount.current = state.count;
	}), [keymap]);

	useKeys(
		[
			{keys: 'gt', desc: 'Next tab, or tab N after a count', group: 'Tabs', run: () => {
				const n = typedCount.current;
				if (n === 0) open(current + 1);
				else if (n <= tabs.length) open(n - 1);
			}},
			{keys: 'gT', desc: 'Previous tab', group: 'Tabs', run: count => open(current - count)},
		],
		{active},
	);

	useMouse(event => {
		if (event.kind !== 'down' || event.button !== 'left') return;
		titles.current.forEach((node, index) => {
			if (!node) return;
			const {x, y} = absolutePosition(node);
			const width = node.yogaNode?.getComputedWidth() ?? 0;
			if (event.y === y && event.x >= x && event.x < x + width) open(index);
		});
	}, active);

	return (
		<Box flexDirection="column" flexGrow={1}>
			<Box height={1} flexShrink={0} overflow="hidden">
				{tabs.map((tab, index) => (
					<Box key={tab.id} ref={node => {
						titles.current[index] = node;
					}} flexShrink={0} marginRight={1}>
						<Text {...(index === current ? {backgroundColor: theme.accent, color: theme.accentText, bold: true} : {color: theme.muted})}>
							{` ${index + 1} ${tab.title} `}
						</Text>
					</Box>
				))}
			</Box>
			{/* The key remounts the content, even when two tabs hold the same component. */}
			<Box key={tabs[current]?.id} flexDirection="column" flexGrow={1} overflow="hidden">
				{tabs[current]?.content}
			</Box>
		</Box>
	);
}

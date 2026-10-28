import {useRef, useState, type ReactNode} from 'react';
import {Box, type DOMElement} from 'ink';
import {useKeys, useMouse} from '../context.js';
import {absolutePosition} from '../layout.js';
import {theme} from '../theme.js';

type Props = {
	/** One render function per pane; `active` is true for the focused pane, to pass on to its List or Pager. */
	panes: ((active: boolean) => ReactNode)[];
	/** Side by side (`row`, the default) or stacked (`column`). */
	direction?: 'row' | 'column';
	/** Flex ratios, e.g. [1, 2] gives the second pane two thirds; equal by default. */
	sizes?: number[];
	active?: boolean;
};

/**
 * Panes side by side or stacked, each in a border that lights up on the
 * focused one. Ctrl-w w cycles the focus, Ctrl-w h/j/k/l moves it, a click
 * focuses the pane under the mouse. Only one level: a Split inside a pane
 * would compete for the same keys.
 */
export function Split({panes, direction = 'row', sizes = [], active = true}: Props) {
	const [focus, setFocus] = useState(0);
	const boxes = useRef<(DOMElement | null)[]>([]);
	const focused = Math.min(focus, panes.length - 1);
	const move = (delta: number) => setFocus(Math.min(panes.length - 1, Math.max(0, focused + delta)));
	const cycle = () => setFocus((focused + 1) % panes.length);
	// h/l move in a row and k/j in a column; the other pair has nowhere to go.
	const step = (vertical: boolean, delta: number) => () => {
		if (vertical === (direction === 'column')) move(delta);
	};

	useKeys(
		[
			{keys: '<C-w>w', desc: 'Next pane', group: 'Panes', run: cycle},
			{keys: '<C-w><C-w>', desc: 'Next pane', group: 'hidden', run: cycle},
			{keys: '<C-w>h', desc: 'Pane to the left', group: 'Panes', run: step(false, -1)},
			{keys: '<C-w>j', desc: 'Pane below', group: 'Panes', run: step(true, 1)},
			{keys: '<C-w>k', desc: 'Pane above', group: 'Panes', run: step(true, -1)},
			{keys: '<C-w>l', desc: 'Pane to the right', group: 'Panes', run: step(false, 1)},
		],
		{active},
	);

	useMouse(event => {
		if (event.kind !== 'down' || event.button !== 'left') return;
		boxes.current.forEach((node, index) => {
			if (!node || index >= panes.length) return;
			const {x, y} = absolutePosition(node);
			const width = node.yogaNode?.getComputedWidth() ?? 0;
			const height = node.yogaNode?.getComputedHeight() ?? 0;
			if (event.x >= x && event.x < x + width && event.y >= y && event.y < y + height) setFocus(index);
		});
	}, active);

	return (
		<Box flexDirection={direction} flexGrow={1}>
			{panes.map((pane, index) => {
				const on = active && index === focused;
				return (
					<Box
						key={index}
						ref={node => {
							boxes.current[index] = node;
						}}
						flexDirection="column"
						flexGrow={sizes[index] ?? 1}
						flexBasis={0}
						overflow="hidden"
						borderStyle="round"
						borderColor={on ? theme.accent : theme.border}
					>
						{pane(on)}
					</Box>
				);
			})}
		</Box>
	);
}

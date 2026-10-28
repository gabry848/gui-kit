import {useLayoutEffect, useState, type RefObject} from 'react';
import {useBoxMetrics, useWindowSize, type DOMElement} from 'ink';

/**
 * The rows a List, Tree or Pager draws when it has no `height`: the height
 * its box is laid out at, the space its parent gives it.
 *
 * A parent that takes its height from its content measures exactly what was
 * drawn, so the box alone cannot tell "one row of room" from "one row drawn".
 * Until the box has been laid out shorter than what it drew, the component
 * draws `natural` rows (its content, up to 10) or the measured height if that
 * is more. Once it has (a Split pane, a Shell, a parent with less room), the
 * measured height is the limit, a single row included; that choice holds
 * until the window changes size, so the height cannot flip back and forth.
 *
 * The box's children must not shrink (`flexShrink={0}` on each row), so the
 * rows they take add up to what was drawn.
 */
export function useAutoHeight(ref: RefObject<DOMElement | null>, natural: number, fixed: number | undefined): number {
	const {height: measured} = useBoxMetrics(ref);
	const {columns, rows} = useWindowSize();
	const size = `${columns}x${rows}`;
	// The window size at which the box was seen cut, with the height it had then.
	const [cut, setCut] = useState<{size: string; height: number} | undefined>();
	const limited = cut?.size === size;

	// After every commit the layout is known: compare the box with the rows inside it.
	useLayoutEffect(() => {
		if (fixed !== undefined || limited) return;
		const node = ref.current;
		const box = node?.yogaNode;
		if (!node || !box) return;
		let drawn = 0;
		for (const child of node.childNodes) {
			const layout = 'yogaNode' in child ? child.yogaNode : undefined;
			if (layout) drawn = Math.max(drawn, layout.getComputedTop() + layout.getComputedHeight());
		}
		const height = box.getComputedHeight();
		if (height < drawn) setCut({size, height});
	});

	if (fixed !== undefined) return fixed;
	if (limited) return measured > 0 ? measured : cut.height;
	return Math.max(measured, natural);
}

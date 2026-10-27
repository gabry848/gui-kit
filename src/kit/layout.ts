import type {DOMElement} from 'ink';

/** Screen position of a laid-out Ink node, summed over its ancestors. */
export function absolutePosition(node: DOMElement): {x: number; y: number} {
	let x = 0;
	let y = 0;
	for (let current: DOMElement | undefined = node; current; current = current.parentNode) {
		x += current.yogaNode?.getComputedLeft() ?? 0;
		y += current.yogaNode?.getComputedTop() ?? 0;
	}
	return {x, y};
}

import {useEffect, useRef} from 'react';

const PRIMITIVE = new Set(['string', 'number', 'boolean', 'bigint', 'undefined']);

/**
 * An item's own string, number and boolean fields as one string (or the item
 * itself when it is one of those). An item rebuilt with the same values gets
 * the same one, so items built anew on every render are still the same item;
 * another item with the same text but a different field (a pid) is not.
 * Nested objects, arrays and functions are left out.
 */
export function fingerprint(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return PRIMITIVE.has(typeof value) || value === null ? `${typeof value}:${String(value)}` : typeof value;
	}
	const parts: string[] = [];
	for (const key of Object.keys(value).sort()) {
		const field = (value as Record<string, unknown>)[key];
		if (field === null || PRIMITIVE.has(typeof field)) parts.push(`${key}=${typeof field}:${String(field)}`);
	}
	return parts.join('\u0000');
}

/**
 * Calls onCursor with `item` each time `signature` changes, first on mount,
 * and with undefined on unmount if it reported an item. The signature, not
 * the item's identity, decides, so a parent that stores the item does not
 * loop when the items are rebuilt on every render.
 */
export function useCursorReport<T>(signature: string | undefined, item: T | undefined, onCursor: ((item: T | undefined) => void) | undefined) {
	const reported = useRef<string | undefined>(undefined);
	const latest = useRef(onCursor);
	latest.current = onCursor;
	useEffect(() => {
		if (signature === reported.current) return;
		reported.current = signature;
		latest.current?.(item);
	});
	useEffect(() => () => {
		if (reported.current !== undefined) latest.current?.(undefined);
	}, []);
}

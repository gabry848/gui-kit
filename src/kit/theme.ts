// One place for the colors every kit component uses.

export const theme = {
	accent: '#7aa2f7',
	accentText: '#1a1b26',
	/** The app background, e.g. for a dark Canvas: `rgb(theme.background)`. */
	background: '#1a1b26',
	text: '#c0caf5',
	muted: '#737aa2',
	border: '#3b4261',
	selection: '#283457',
	success: '#9ece6a',
	warning: '#e0af68',
	danger: '#f7768e',
	modes: {
		normal: '#7aa2f7',
		insert: '#9ece6a',
		command: '#e0af68',
	},
} as const;

/** A theme color such as `theme.accent` as the [r, g, b] the Canvas wants. */
export function rgb(hex: string): [number, number, number] {
	const value = Number.parseInt(hex.replace('#', ''), 16);
	return [(value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF];
}

// The last open tab per project folder, in the app's data folder
// (GUI_DATA_DIR). Best effort: a missing or broken file means the first tab.

import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const FILE = 'last-tab.json';
const MAX_FOLDERS = 200;

function read(dataDir: string): Record<string, string> {
	try {
		const parsed = JSON.parse(readFileSync(join(dataDir, FILE), 'utf8')) as unknown;
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
	} catch {
		return {};
	}
}

export function loadLastTab(dataDir: string | undefined, folder: string): string | undefined {
	if (!dataDir) return undefined;
	const tab = read(dataDir)[folder];
	return typeof tab === 'string' ? tab : undefined;
}

export function saveLastTab(dataDir: string | undefined, folder: string, tab: string) {
	if (!dataDir) return;
	const tabs = read(dataDir);
	// Most recent last, so the oldest folders drop out first.
	delete tabs[folder];
	tabs[folder] = tab;
	const kept = Object.entries(tabs).slice(-MAX_FOLDERS);
	try {
		writeFileSync(join(dataDir, FILE), JSON.stringify(Object.fromEntries(kept), null, '\t') + '\n');
	} catch {
		// A read-only data folder only loses the memory of the tab.
	}
}

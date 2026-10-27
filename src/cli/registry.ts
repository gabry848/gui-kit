// Installed apps: a name linked to a project folder, kept in one JSON file.

import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';

export type Manifest = {name: string; description?: string; entry: string};

export type Installed = {
	path: string;
	entry: string;
	description?: string;
	/** Launcher this kit wrote in ~/.local/bin, removed on uninstall. */
	bin?: string;
	installed: string;
};

const dataHome = process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share');
export const GUI_HOME = process.env['GUI_HOME'] ?? join(dataHome, 'gui');
const REGISTRY = join(GUI_HOME, 'registry.json');

export function loadRegistry(): Record<string, Installed> {
	if (!existsSync(REGISTRY)) return {};
	return (JSON.parse(readFileSync(REGISTRY, 'utf8')) as {apps: Record<string, Installed>}).apps;
}

export function saveRegistry(apps: Record<string, Installed>) {
	mkdirSync(dirname(REGISTRY), {recursive: true});
	writeFileSync(REGISTRY, JSON.stringify({apps}, null, '\t') + '\n');
}

export function readManifest(dir: string): Manifest | undefined {
	const file = join(dir, 'gui.json');
	return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Manifest) : undefined;
}

export type Target = {file: string; name?: string; dir: string};

/** An installed name, a project folder with gui.json, or a single app file. */
export function resolveTarget(arg: string): Target {
	const apps = loadRegistry();
	const installed = apps[arg];
	// A bare name means the installed app, even if a folder of that name sits
	// here; write ./name to mean the folder.
	if (installed && !arg.includes('/')) {
		return {file: join(installed.path, installed.entry), name: arg, dir: installed.path};
	}
	const path = resolve(arg);
	if (existsSync(path) && statSync(path).isDirectory()) {
		const manifest = readManifest(path);
		if (!manifest) throw new Error(`${arg}: la cartella non ha un gui.json`);
		return {file: join(path, manifest.entry), name: manifest.name, dir: path};
	}
	if (existsSync(path)) return {file: path, dir: dirname(path)};
	throw new Error(`${arg}: non è un'app installata, una cartella con gui.json o un file. \`gui ls\` elenca le app.`);
}

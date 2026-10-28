// Installed apps: a name linked to a project folder, kept in one JSON file.

import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {parsePermissions, type Grant} from './permissions.js';

export type Manifest = {
	name: string;
	description?: string;
	entry: string;
	/** Versions of gui-kit the app works with, as a semver range. */
	kit?: string;
	permissions: Grant;
};

export type Installed = {
	path: string;
	entry: string;
	description?: string;
	/** The kit version it runs on: a copy in GUI_HOME/kits. Missing for apps installed before kit versions. */
	kit?: string;
	/** What you allowed at install. */
	permissions: Grant;
	/** Launcher this kit wrote in ~/.local/bin, removed on uninstall. */
	bin?: string;
	installed: string;
};

const dataHome = process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share');
export const GUI_HOME = process.env['GUI_HOME'] ?? join(dataHome, 'gui');
const REGISTRY = join(GUI_HOME, 'registry.json');

export function loadRegistry(): Record<string, Installed> {
	if (!existsSync(REGISTRY)) return {};
	const apps = (JSON.parse(readFileSync(REGISTRY, 'utf8')) as {apps: Record<string, Partial<Installed>>}).apps;
	// Entries from before permissions ran with full access.
	for (const app of Object.values(apps)) app.permissions ??= 'full';
	return apps as Record<string, Installed>;
}

export function saveRegistry(apps: Record<string, Installed>) {
	mkdirSync(dirname(REGISTRY), {recursive: true});
	writeFileSync(REGISTRY, JSON.stringify({apps}, null, '\t') + '\n');
}

export function readManifest(dir: string): Manifest | undefined {
	const file = join(dir, 'gui.json');
	if (!existsSync(file)) return undefined;
	const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
	if (typeof raw['name'] !== 'string' || typeof raw['entry'] !== 'string') throw new Error(`${file}: needs "name" and "entry"`);
	if (raw['kit'] !== undefined && (typeof raw['kit'] !== 'string' || raw['kit'].trim() === '')) throw new Error(`${file}: "kit" must be a semver range like "^0.1.0"`);
	return {
		name: raw['name'],
		entry: raw['entry'],
		...(typeof raw['description'] === 'string' ? {description: raw['description']} : {}),
		...(typeof raw['kit'] === 'string' ? {kit: raw['kit']} : {}),
		permissions: parsePermissions(raw['permissions'], file),
	};
}

export type Target = {
	file: string;
	dir: string;
	name?: string;
	manifest?: Manifest;
	/** Set when the app was started by its installed name. */
	installed?: Installed;
};

/** An installed name, a project folder with gui.json, or a single app file. */
export function resolveTarget(arg: string): Target {
	const apps = loadRegistry();
	const installed = apps[arg];
	// A bare name means the installed app, even if a folder of that name sits
	// here; write ./name to mean the folder.
	if (installed && !arg.includes('/')) {
		const manifest = readManifest(installed.path);
		if (!manifest) throw new Error(`${arg}: ${installed.path} has no gui.json any more; gui uninstall ${arg} removes it`);
		return {file: join(installed.path, manifest.entry), name: arg, dir: installed.path, manifest, installed};
	}
	const path = resolve(arg);
	if (existsSync(path) && statSync(path).isDirectory()) {
		const manifest = readManifest(path);
		if (!manifest) throw new Error(`${arg}: the folder has no gui.json`);
		return {file: join(path, manifest.entry), name: manifest.name, dir: path, manifest};
	}
	if (existsSync(path)) return {file: path, dir: dirname(path)};
	throw new Error(`${arg}: not an installed app, a folder with gui.json or a file. \`gui ls\` lists the apps.`);
}

// Installed apps: a name linked to a project folder, kept in one JSON file.

import {existsSync, mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {parsePermissions, real, type Grant} from './permissions.js';

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

/** An app name: it names the data folder GUI_HOME/data/<name>, so it can never hold `/` or `..`. */
export const NAME = /^[a-z0-9][a-z0-9-]*$/;

export function readManifest(dir: string): Manifest | undefined {
	const file = join(dir, 'gui.json');
	if (!existsSync(file)) return undefined;
	const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
	if (typeof raw['name'] !== 'string' || typeof raw['entry'] !== 'string') throw new Error(`${file}: needs "name" and "entry"`);
	if (!NAME.test(raw['name'])) throw new Error(`${file}: "name" uses only lowercase letters, digits and dashes`);
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
		return project(apps, path, manifest);
	}
	if (existsSync(path)) {
		// The entry file of a project is that project: the same kit, gui.json and sandbox.
		const dir = dirname(path);
		if (entryOf(dir) === real(path)) return project(apps, dir, readManifest(dir)!);
		return {file: path, dir};
	}
	throw new Error(`${arg}: not an installed app, a folder with gui.json or a file. \`gui ls\` lists the apps.`);
}

/** A project folder; when it is installed, the installed app, so its approval and kit apply. */
function project(apps: Record<string, Installed>, dir: string, manifest: Manifest): Target {
	const target: Target = {file: join(dir, manifest.entry), name: manifest.name, dir, manifest};
	const name = installedAt(apps, dir, manifest.name);
	return name ? {...target, name, installed: apps[name]!} : target;
}

/** The name an app is installed under from `dir`, preferring `name` when the folder is installed under several. */
export function installedAt(apps: Record<string, Installed>, dir: string, name?: string): string | undefined {
	const here = real(dir);
	const names = Object.keys(apps).filter(key => real(apps[key]!.path) === here);
	return name && names.includes(name) ? name : names[0];
}

/** The resolved entry file a folder's gui.json names, if it has one. */
function entryOf(dir: string): string | undefined {
	const file = join(dir, 'gui.json');
	if (!existsSync(file)) return undefined;
	try {
		const raw = JSON.parse(readFileSync(file, 'utf8')) as {entry?: unknown};
		return typeof raw.entry === 'string' ? real(resolve(dir, raw.entry)) : undefined;
	} catch {
		// Not a gui.json of ours: the file is a single-file app.
		return undefined;
	}
}

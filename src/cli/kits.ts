// Kit versions. An installed app runs on a copy of the kit taken when it was
// installed (GUI_HOME/kits/<version>), so changing the kit later cannot break
// it. Apps declare the versions they work with in gui.json ("kit": "^0.1.0").
// A project folder links that copy in its node_modules, so Bun, tsc and
// editors all find the same gui-kit and React; a single file gets them
// through NODE_PATH.
//
// The CLI of one version starts apps through the launch.tsx and screen.tsx of
// another, so their arguments and the GUI_ARGS / GUI_APP_DIR / GUI_DATA_DIR
// variables must stay the same across versions.

import {cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {GUI_HOME} from './registry.js';

export const KIT = resolve(import.meta.dir, '..', '..');
export const KIT_VERSION = (JSON.parse(readFileSync(join(KIT, 'package.json'), 'utf8')) as {version: string}).version;
export const KITS = join(GUI_HOME, 'kits');

export type Kit = {version: string; dir: string; current: boolean};

/** Packages only needed to develop the kit, left out of copies; type packages stay for editors and gui check. */
const DEV_ONLY = new Set(['typescript', '@typescript']);

/** What a project's node_modules links to in its kit. */
const LINKS = {'gui-kit': '.', 'react': 'node_modules/react', '@types': 'node_modules/@types'} as const;

export function currentKit(): Kit {
	return {version: KIT_VERSION, dir: KIT, current: true};
}

export function savedKits(): Kit[] {
	if (!existsSync(KITS)) return [];
	return readdirSync(KITS)
		.filter(name => !name.startsWith('.') && existsSync(join(KITS, name, 'package.json')))
		.map(version => ({version, dir: join(KITS, version), current: false}));
}

function newestFirst(kits: Kit[]): Kit[] {
	return kits.sort((a, b) => Bun.semver.order(b.version, a.version) || Number(b.current) - Number(a.current));
}

/** The newest kit that satisfies `range`; this kit when there is no range. */
export function pickKit(range: string | undefined): Kit {
	if (!range) return currentKit();
	const kit = newestFirst([currentKit(), ...savedKits()]).find(candidate => Bun.semver.satisfies(candidate.version, range));
	if (!kit) {
		throw new Error(`needs gui-kit ${range}, but this gui has ${KIT_VERSION}${savedKits().length ? ` and saved copies ${savedKits().map(saved => saved.version).join(', ')}` : ''}: change "kit" in gui.json or install a matching gui-kit`);
	}
	return kit;
}

/** The saved copy for an installed app, taken again if it was removed and this kit still has that version. */
export function pinnedKit(version: string): Kit {
	const dir = join(KITS, version);
	if (existsSync(join(dir, 'package.json'))) return {version, dir, current: false};
	if (version === KIT_VERSION) return saveKit();
	throw new Error(`gui-kit ${version}, which this app was installed with, is gone (this gui has ${KIT_VERSION}): reinstall it with gui install <folder>`);
}

/** Copies this kit to GUI_HOME/kits/<version>, replacing an older copy of the same version. */
export function saveKit(): Kit {
	const target = join(KITS, KIT_VERSION);
	const staging = join(KITS, `.${KIT_VERSION}-${process.pid}`);
	rmSync(staging, {recursive: true, force: true});
	mkdirSync(staging, {recursive: true});
	for (const entry of ['package.json', 'testing.ts', 'bin', 'src']) {
		copy(join(KIT, entry), join(staging, entry));
	}
	mkdirSync(join(staging, 'node_modules'));
	for (const entry of readdirSync(join(KIT, 'node_modules'))) {
		if (!DEV_ONLY.has(entry) && !entry.startsWith('.')) copy(join(KIT, 'node_modules', entry), join(staging, 'node_modules', entry));
	}
	rmSync(target, {recursive: true, force: true});
	renameSync(staging, target);
	return {version: KIT_VERSION, dir: target, current: false};
}

function copy(from: string, to: string) {
	if (process.platform === 'darwin') {
		// APFS clones: a full copy that takes no space until a file changes.
		const proc = Bun.spawnSync(['cp', '-cRP', from, to]);
		if (proc.success) return;
	}
	cpSync(from, to, {recursive: true, verbatimSymlinks: true});
}

function kitAt(dir: string): Kit | undefined {
	const file = join(dir, 'package.json');
	if (!existsSync(file)) return undefined;
	const {name, version} = JSON.parse(readFileSync(file, 'utf8')) as {name?: string; version: string};
	return name === 'gui-kit' ? {version, dir, current: realpathSync(dir) === realpathSync(KIT)} : undefined;
}

/** The kit a project folder links in its node_modules, if any. */
export function linkedKit(project: string): Kit | undefined {
	const link = join(project, 'node_modules', 'gui-kit');
	return existsSync(link) ? kitAt(realpathSync(link)) : undefined;
}

/** Points a project's node_modules at `kit`, replacing only links gui made. */
export function linkKit(project: string, kit: Kit) {
	const modules = join(project, 'node_modules');
	for (const [name, inKit] of Object.entries(LINKS)) {
		const link = join(modules, name);
		const target = join(kit.dir, inKit);
		const existing = lstatSafe(link);
		if (existing && !existing.isSymbolicLink()) throw new Error(`${link} is not a link gui made: remove it so the app can use gui-kit ${kit.version}`);
		if (existing && readlinkSync(link) === target) continue;
		if (existing) rmSync(link);
		mkdirSync(modules, {recursive: true});
		symlinkSync(target, link);
	}
}

function lstatSafe(path: string) {
	try {
		return lstatSync(path);
	} catch {
		return undefined;
	}
}

/** Environment that lets an app anywhere import 'gui-kit', React and Ink from `kit`. */
export function kitEnv(kit: Kit): Record<string, string> {
	// Resolved paths: inside the sandbox Bun cannot search NODE_PATH through a symlink such as /var.
	const runtime = join(realpathSync(kit.dir), 'runtime', 'node_modules');
	const link = join(runtime, 'gui-kit');
	if (!existsSync(link)) {
		mkdirSync(runtime, {recursive: true});
		try {
			symlinkSync(relative(runtime, realpathSync(kit.dir)), link);
		} catch (error) {
			// Another app starting at the same time made it first.
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		}
	}
	return {NODE_PATH: [runtime, join(realpathSync(kit.dir), 'node_modules')].join(':')};
}

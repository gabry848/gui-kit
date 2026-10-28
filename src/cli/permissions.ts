// What a saved app may do, declared in gui.json and approved at install.
// On macOS the app runs inside sandbox-exec with a profile built from it;
// elsewhere the permissions are shown and approved but not enforced.

import {existsSync, realpathSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {isAbsolute, join, resolve} from 'node:path';

export type Permissions = {
	/** Folders or files the app may read inside your home, besides its own folder and data. */
	read?: string[];
	/** Folders or files the app may write, besides its data folder and temp. */
	write?: string[];
	/** Network: false (default), 'local' for localhost only, or true. */
	net?: boolean | 'local';
	/** Commands the app may run, by name (`git`), or `*` for any. */
	run?: string[];
};

/** An app without a `permissions` field runs with your full access. */
export type Grant = Permissions | 'full';

export const ENFORCED = process.platform === 'darwin' && existsSync('/usr/bin/sandbox-exec');

const NET_LEVEL = {false: 0, local: 1, true: 2} as const;

export function parsePermissions(value: unknown, where: string): Grant {
	if (value === undefined) return 'full';
	if (value === 'full') return 'full';
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${where}: "permissions" must be an object or "full"`);
	const raw = value as Record<string, unknown>;
	for (const key of Object.keys(raw)) {
		if (!['read', 'write', 'net', 'run'].includes(key)) throw new Error(`${where}: unknown permission "${key}" (use read, write, net, run)`);
	}
	const list = (key: string): string[] | undefined => {
		const entry = raw[key];
		if (entry === undefined) return undefined;
		if (!Array.isArray(entry) || !entry.every(item => typeof item === 'string' && item !== '')) {
			throw new Error(`${where}: "permissions.${key}" must be a list of strings`);
		}
		return entry as string[];
	};
	const net = raw['net'];
	if (net !== undefined && net !== true && net !== false && net !== 'local') throw new Error(`${where}: "permissions.net" must be true, false or "local"`);
	const grant: Permissions = {};
	const read = list('read');
	const write = list('write');
	const run = list('run');
	if (read?.length) grant.read = read;
	if (write?.length) grant.write = write;
	if (net) grant.net = net;
	if (run?.length) grant.run = run;
	return grant;
}

/** True when an app asks for nothing beyond what every app gets. */
export function isBaseline(grant: Grant): boolean {
	return grant !== 'full' && !grant.read && !grant.write && !grant.net && !grant.run;
}

/** True when `approved` already allows everything `requested` asks for. */
export function covers(approved: Grant | undefined, requested: Grant): boolean {
	if (isBaseline(requested)) return true;
	if (approved === undefined) return false;
	if (approved === 'full') return true;
	if (requested === 'full') return false;
	const within = (asked: string[] = [], allowed: string[] = []) => asked.every(entry => allowed.includes(entry));
	const runOk = approved.run?.includes('*') || within(requested.run, approved.run);
	return within(requested.read, [...(approved.read ?? []), ...(approved.write ?? [])])
		&& within(requested.write, approved.write)
		&& NET_LEVEL[String(requested.net ?? false) as keyof typeof NET_LEVEL] <= NET_LEVEL[String(approved.net ?? false) as keyof typeof NET_LEVEL]
		&& Boolean(runOk);
}

export function describe(grant: Grant): string[] {
	if (grant === 'full') return ['full access: it declares no permissions, so it can do anything you can'];
	if (isBaseline(grant)) return ['nothing beyond its own folder, its data folder and the terminal'];
	const lines: string[] = [];
	if (grant.read) lines.push(`read   ${grant.read.join(', ')}`);
	if (grant.write) lines.push(`write  ${grant.write.join(', ')}`);
	if (grant.net) lines.push(`net    ${grant.net === 'local' ? 'localhost only' : 'any host'}`);
	if (grant.run) lines.push(`run    ${grant.run.includes('*') ? 'any command' : grant.run.join(', ')}`);
	return lines;
}

export type Places = {app: string; kit: string; data: string; cwd: string};

/** `$CWD`, `$APP`, `$DATA`, `$HOME`, `$TMP` and `~` expand; other relative paths are inside the app folder. */
export function expandPath(entry: string, places: Places): string {
	const home = homedir();
	let path = entry
		.replace(/^~(?=\/|$)/, home)
		.replace(/^\$(CWD|APP|DATA|HOME|TMP)(?=\/|$)/, (_, name: string) => ({CWD: places.cwd, APP: places.app, DATA: places.data, HOME: home, TMP: tmpdir()})[name]!);
	if (!isAbsolute(path)) path = resolve(places.app, path);
	return real(path);
}

/** The sandbox matches resolved paths: /tmp is /private/tmp on macOS. */
function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

function quote(path: string): string {
	return JSON.stringify(path);
}

/** Every path a command name can exec through, including the tools behind /usr/bin shims. */
function executables(name: string): string[] {
	const found = Bun.which(name);
	const paths = new Set<string>();
	if (found) {
		paths.add(found);
		paths.add(real(found));
	}
	if (found?.startsWith('/usr/bin/')) {
		// /usr/bin/git and friends hand over to the developer tools.
		for (const developer of ['/Library/Developer/CommandLineTools', '/Applications/Xcode.app/Contents/Developer']) {
			paths.add(join(developer, 'usr', 'bin', name));
		}
	}
	return [...paths];
}

/** The sandbox-exec profile for an app, or undefined when it runs unrestricted. */
export function sandboxProfile(grant: Grant, places: Places): string | undefined {
	if (grant === 'full' || !ENFORCED) return undefined;
	const home = real(homedir());
	const expand = (entries: string[] = []) => entries.map(entry => expandPath(entry, places));
	const read = expand(grant.read);
	const write = expand(grant.write);
	const bun = [process.execPath, real(process.execPath)];
	const bunHome = join(home, '.bun');
	const lines = [
		'(version 1)',
		'(allow default)',
		// Reading inside your home is limited to what the app needs and declares.
		`(deny file-read-data (subpath ${quote(home)}))`,
		`(allow file-read-data ${[places.app, places.kit, places.data, bunHome, ...read, ...write].map(path => `(subpath ${quote(real(path))})`).join(' ')})`,
		'(deny file-write*)',
		`(allow file-write* (subpath "/dev") (subpath ${quote(real(tmpdir()))}) (subpath "/private/tmp") (subpath "/private/var/folders") ${[places.data, ...write].map(path => `(subpath ${quote(real(path))})`).join(' ')})`,
	];
	if (grant.net !== true) {
		lines.push('(deny network-outbound (remote ip))');
		if (grant.net === 'local') lines.push('(allow network-outbound (remote ip "localhost:*"))');
	}
	if (!grant.run?.includes('*')) {
		// Setuid programs such as ps never run in the sandbox, even when listed.
		const allowed = new Set([...bun, ...(grant.run ?? []).flatMap(executables)]);
		lines.push('(deny process-exec*)');
		lines.push(`(allow process-exec* ${[...allowed].map(path => `(literal ${quote(path)})`).join(' ')})`);
		if (grant.run?.includes('git')) {
			lines.push('(allow process-exec* (subpath "/Library/Developer/CommandLineTools/usr/libexec/git-core") (subpath "/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core"))');
		}
	}
	return lines.join('\n') + '\n';
}

/** The command line that starts `argv` inside the app's sandbox. */
export function sandboxed(argv: string[], grant: Grant, places: Places): string[] {
	const profile = sandboxProfile(grant, places);
	return profile ? ['/usr/bin/sandbox-exec', '-p', profile, ...argv] : argv;
}

// Pure parsers for what workbench reads from git, lsof, package.json and
// Makefiles, kept apart from the UI so they can be tested on plain strings.

export type GitEntry = {
	/** The two status letters of porcelain v1: index then work tree, e.g. 'M ', ' M', '??'. */
	status: string;
	/** Relative to the repository root; untracked folders end with '/'. */
	path: string;
	/** The path before a rename or copy. */
	from?: string;
};

export type Branch = {
	/** Missing when HEAD is detached. */
	name?: string;
	upstream?: string;
	ahead: number;
	behind: number;
	/** The upstream branch was deleted. */
	gone: boolean;
	/** No commit yet. */
	initial: boolean;
};

/** The `## ...` header of `git status --branch`. */
export function parseBranch(header: string): Branch {
	const text = header.replace(/^## /, '');
	const branch: Branch = {ahead: 0, behind: 0, gone: false, initial: false};
	const initial = /^(?:No commits yet|Initial commit) on (.+)$/.exec(text);
	if (initial) return {...branch, name: initial[1]!, initial: true};
	if (text.startsWith('HEAD (no branch)')) return branch;
	// Branch names cannot contain '...' or spaces, so the separators are safe.
	const match = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(text);
	if (!match) return {...branch, name: text};
	const flags = match[3] ?? '';
	return {
		...branch,
		name: match[1]!,
		...(match[2] ? {upstream: match[2]} : {}),
		ahead: Number(/ahead (\d+)/.exec(flags)?.[1] ?? 0),
		behind: Number(/behind (\d+)/.exec(flags)?.[1] ?? 0),
		gone: flags.includes('gone'),
	};
}

/**
 * `git status --porcelain=v1 -z --branch`: NUL-separated entries, the branch
 * header first. A rename or copy is followed by an extra field, its old path.
 */
export function parseStatus(output: string): {branch: Branch | undefined; entries: GitEntry[]} {
	const fields = output.split('\0');
	let branch: Branch | undefined;
	const entries: GitEntry[] = [];
	for (let index = 0; index < fields.length; index++) {
		const field = fields[index]!;
		if (field === '') continue;
		if (field.startsWith('## ')) {
			branch = parseBranch(field);
			continue;
		}
		const status = field.slice(0, 2);
		const path = field.slice(3);
		if (status.includes('R') || status.includes('C')) {
			const from = fields[++index];
			entries.push({status, path, ...(from ? {from} : {})});
		} else {
			entries.push({status, path});
		}
	}
	return {branch, entries};
}

/** One line about the branch, e.g. "main → origin/main, ahead 1". */
export function describeBranch(branch: Branch | undefined): string {
	if (!branch) return 'unknown branch';
	if (!branch.name) return 'detached HEAD';
	if (branch.initial) return `${branch.name}, no commits yet`;
	const parts = [branch.upstream ? `${branch.name} → ${branch.upstream}` : `${branch.name}, no upstream`];
	if (branch.gone) parts.push('upstream gone');
	if (branch.ahead) parts.push(`ahead ${branch.ahead}`);
	if (branch.behind) parts.push(`behind ${branch.behind}`);
	return parts.join(', ');
}

export type Port = {
	command: string;
	pid: number;
	user: string;
	/** As lsof prints it: `*:3000`, `127.0.0.1:5432`, `[::1]:8080`. */
	address: string;
	port: number;
};

// COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME, e.g.
// node  7914 me  23u  IPv4 0xa832...  0t0  TCP 127.0.0.1:4111 (LISTEN)
const LSOF_LINE = /^(\S+)\s+(\d+)\s+(\S+)\s+\S+\s+IPv[46]\s+\S+\s+\S+\s+TCP\s+(\S+)(?:\s+\(LISTEN\))?\s*$/;

/**
 * `lsof -nP -iTCP -sTCP:LISTEN [+c 0]`, one row per process and address,
 * sorted by port. A process listening on IPv4 and IPv6 `*:3000` shows once.
 * With `+c 0` lsof escapes spaces in names as \x20.
 */
export function parseLsof(output: string): Port[] {
	const seen = new Set<string>();
	const ports: Port[] = [];
	for (const line of output.split('\n')) {
		const match = LSOF_LINE.exec(line);
		if (!match) continue;
		const pid = Number(match[2]);
		const address = match[4]!;
		const key = `${pid} ${address}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const command = match[1]!.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
		ports.push({command, pid, user: match[3]!, address, port: Number(/:(\d+)$/.exec(address)?.[1] ?? 0)});
	}
	return ports.sort((a, b) => a.port - b.port || a.pid - b.pid);
}

export type Task = {
	name: string;
	/** Where it comes from, also the runner: bun, npm or make. */
	kind: 'bun' | 'npm' | 'make';
	argv: string[];
	/** What the script runs, shown next to its name. */
	detail: string;
};

/** Scripts of a package.json, run with npm when the project has a package-lock.json and no bun lock. */
export function packageTasks(json: string, locks: {npm: boolean; bun: boolean}): Task[] {
	let scripts: unknown;
	try {
		scripts = (JSON.parse(json) as {scripts?: unknown}).scripts;
	} catch {
		return [];
	}
	if (typeof scripts !== 'object' || scripts === null) return [];
	const kind = locks.npm && !locks.bun ? 'npm' : 'bun';
	return Object.entries(scripts)
		.filter((entry): entry is [string, string] => typeof entry[1] === 'string')
		.map(([name, detail]) => ({name, kind, argv: [kind, 'run', name], detail}));
}

const MAKE_DIRECTIVE = /^(?:export|unexport|include|-include|sinclude|override|define|endef|ifeq|ifneq|ifdef|ifndef|else|endif|vpath)\b/;

/**
 * Explicit targets of a Makefile, in order: no special targets (.PHONY),
 * pattern rules (%.o), variables ($(OUT)) or assignments (A := b).
 */
export function makeTargets(text: string): string[] {
	const targets: string[] = [];
	let inDefine = false;
	for (const line of text.split('\n')) {
		if (inDefine) {
			if (/^endef\b/.test(line)) inDefine = false;
			continue;
		}
		if (/^define\b/.test(line)) {
			inDefine = true;
			continue;
		}
		// Recipes start with a tab; comments and directives are not rules.
		if (line.startsWith('\t') || line.startsWith('#') || MAKE_DIRECTIVE.test(line)) continue;
		// Targets, then ':' or '::', but not ':=' or '::='; no '=' before it (an assignment).
		const match = /^([^:#=\s][^:#=]*?)\s*::?(?!=)/.exec(line);
		if (!match) continue;
		for (const name of match[1]!.split(/\s+/)) {
			if (!name || name.startsWith('.') || name.includes('%') || name.includes('$') || targets.includes(name)) continue;
			targets.push(name);
		}
	}
	return targets;
}

export function makeTasks(text: string): Task[] {
	return makeTargets(text).map(name => ({name, kind: 'make', argv: ['make', name], detail: `make ${name}`}));
}

/** PNG or JPEG, from the first bytes, as the kit's Image decodes them. */
export function imageKind(bytes: Uint8Array): 'png' | 'jpeg' | undefined {
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'png';
	if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'jpeg';
	return undefined;
}

/** Git's rule: a NUL byte in the first 8000 bytes means binary. */
export function looksBinary(bytes: Uint8Array): boolean {
	return bytes.subarray(0, 8000).includes(0);
}

export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

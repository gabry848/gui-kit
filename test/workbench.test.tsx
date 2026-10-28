import {afterAll, beforeAll, expect, test} from 'bun:test';
import {plugin} from 'bun';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import * as kit from '../src/kit/index.js';
import {headless} from '../src/kit/testing.js';
import {describeBranch, formatSize, imageKind, looksBinary, makeTargets, makeTasks, packageTasks, parseBranch, parseLsof, parseStatus, type Port} from '../apps/workbench/parse.js';
import {loadLastTab, saveLastTab} from '../apps/workbench/state.js';
import type * as AppModule from '../apps/workbench/app.js';
import type * as FilesModule from '../apps/workbench/files.js';
import type {PortSource} from '../apps/workbench/ports.js';

// The app imports 'gui-kit', which the CLI provides through NODE_PATH. Here
// it is a virtual module holding this very kit, so the app and the headless
// harness share one KitProvider context.
plugin({name: 'gui-kit', setup(build) {
	build.module('gui-kit', () => ({exports: kit, loader: 'object'}));
}});
const {default: Workbench} = await import('../apps/workbench/app.js') as typeof AppModule;
const {listDir, readPreview, TEXT_CAP} = await import('../apps/workbench/files.js') as typeof FilesModule;

type App = Awaited<ReturnType<typeof headless>>;

/** Waits until the screen contains `text`, for things that take real time (git, tasks). */
async function until(app: App, text: string, ms = 5000) {
	const end = Date.now() + ms;
	while (!app.screen().includes(text)) {
		if (Date.now() > end) throw new Error(`"${text}" never showed up:\n${app.screen()}`);
		await app.settle(20);
	}
}

// --- parsers -------------------------------------------------------------

test('git status: branch header, staged, unstaged, untracked, renames', () => {
	const output = [
		'## main...origin/main [ahead 2, behind 1]',
		'M  README.md',
		' M src/index.ts',
		'MM both.ts',
		'R  new name.ts', 'old name.ts',
		'?? notes/',
		'?? scratch.txt',
		'',
	].join('\0');
	const {branch, entries} = parseStatus(output);
	expect(branch).toEqual({name: 'main', upstream: 'origin/main', ahead: 2, behind: 1, gone: false, initial: false});
	expect(entries).toEqual([
		{status: 'M ', path: 'README.md'},
		{status: ' M', path: 'src/index.ts'},
		{status: 'MM', path: 'both.ts'},
		{status: 'R ', path: 'new name.ts', from: 'old name.ts'},
		{status: '??', path: 'notes/'},
		{status: '??', path: 'scratch.txt'},
	]);
	expect(parseStatus('')).toEqual({branch: undefined, entries: []});
});

test('git branch header: no upstream, gone, first commit, detached', () => {
	expect(parseBranch('## feature')).toMatchObject({name: 'feature', ahead: 0, behind: 0});
	expect(parseBranch('## feature').upstream).toBeUndefined();
	expect(parseBranch('## fix...origin/fix [gone]')).toMatchObject({name: 'fix', upstream: 'origin/fix', gone: true});
	expect(parseBranch('## No commits yet on main')).toMatchObject({name: 'main', initial: true});
	expect(parseBranch('## Initial commit on trunk')).toMatchObject({name: 'trunk', initial: true});
	expect(parseBranch('## HEAD (no branch)').name).toBeUndefined();

	expect(describeBranch(parseBranch('## main...origin/main [ahead 2, behind 1]'))).toBe('main → origin/main, ahead 2, behind 1');
	expect(describeBranch(parseBranch('## feature'))).toBe('feature, no upstream');
	expect(describeBranch(parseBranch('## fix...origin/fix [gone]'))).toBe('fix → origin/fix, upstream gone');
	expect(describeBranch(parseBranch('## No commits yet on main'))).toBe('main, no commits yet');
	expect(describeBranch(parseBranch('## HEAD (no branch)'))).toBe('detached HEAD');
});

const LSOF = `COMMAND                           PID     USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
ControlCenter                     642 me          9u  IPv4 0x4ca65c9e3450ae67      0t0  TCP *:7000 (LISTEN)
ControlCenter                     642 me         10u  IPv6 0x7177b5abdc6d4f62      0t0  TCP *:7000 (LISTEN)
Discord\\x20Helper\\x20(Renderer)  7885 me         38u  IPv4 0xa1a7cbab91e0c7e2      0t0  TCP 127.0.0.1:6463 (LISTEN)
node                             7914 me         23u  IPv4 0xa83289356feefab8      0t0  TCP 127.0.0.1:4111 (LISTEN)
node                             7914 me         24u  IPv6 0xa83289356feefab9      0t0  TCP [::1]:4111 (LISTEN)
postgres                          301 _postgres   7u  IPv4 0xa83289356feefaba      0t0  TCP 127.0.0.1:5432 (LISTEN)
lsof: WARNING: can't stat() smbfs file system /Volumes/share
`;

test('lsof: one row per process and address, names unescaped, sorted by port', () => {
	expect(parseLsof(LSOF)).toEqual([
		{command: 'node', pid: 7914, user: 'me', address: '127.0.0.1:4111', port: 4111},
		{command: 'node', pid: 7914, user: 'me', address: '[::1]:4111', port: 4111},
		{command: 'postgres', pid: 301, user: '_postgres', address: '127.0.0.1:5432', port: 5432},
		{command: 'Discord Helper (Renderer)', pid: 7885, user: 'me', address: '127.0.0.1:6463', port: 6463},
		{command: 'ControlCenter', pid: 642, user: 'me', address: '*:7000', port: 7000},
	]);
	expect(parseLsof('')).toEqual([]);
});

test('package.json scripts: bun by default, npm with only a package-lock.json', () => {
	const json = JSON.stringify({scripts: {test: 'bun test', build: 'tsc -p .', broken: 42}});
	expect(packageTasks(json, {npm: false, bun: false})).toEqual([
		{name: 'test', kind: 'bun', argv: ['bun', 'run', 'test'], detail: 'bun test'},
		{name: 'build', kind: 'bun', argv: ['bun', 'run', 'build'], detail: 'tsc -p .'},
	]);
	expect(packageTasks(json, {npm: true, bun: false}).map(task => task.argv)).toEqual([['npm', 'run', 'test'], ['npm', 'run', 'build']]);
	expect(packageTasks(json, {npm: true, bun: true})[0]!.kind).toBe('bun');
	expect(packageTasks('{"name": "x"}', {npm: false, bun: false})).toEqual([]);
	expect(packageTasks('{not json', {npm: false, bun: false})).toEqual([]);
});

test('Makefile targets: rules in order, without special, pattern, variable or assignment lines', () => {
	const makefile = [
		'CC := cc',
		'OUT = build',
		'FLAGS ?= -O2',
		'.PHONY: all test clean',
		'all: build test',
		'\t@echo all',
		'build test: deps',
		'\t$(CC) -o $(OUT) main.c # all: not a rule',
		'%.o: %.c',
		'$(OUT)/x: y',
		'# hidden: a comment',
		'install:: build',
		'release: FLAGS := -O3',
		'define BANNER',
		'banner: inside a define',
		'endef',
		'clean:',
		'all: again',
		'export PATH := /bin',
		'',
	].join('\n');
	expect(makeTargets(makefile)).toEqual(['all', 'build', 'test', 'install', 'release', 'clean']);
	expect(makeTasks('lint:\n\techo ok\n')).toEqual([{name: 'lint', kind: 'make', argv: ['make', 'lint'], detail: 'make lint'}]);
});

test('file kinds and sizes', () => {
	expect(imageKind(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D]))).toBe('png');
	expect(imageKind(new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]))).toBe('jpeg');
	expect(imageKind(new TextEncoder().encode('hello'))).toBeUndefined();
	expect(looksBinary(new Uint8Array([104, 0, 105]))).toBe(true);
	expect(looksBinary(new TextEncoder().encode('plain text\n'))).toBe(false);
	expect(formatSize(512)).toBe('512 B');
	expect(formatSize(2048)).toBe('2.0 KB');
	expect(formatSize(3 * 1024 * 1024 + 1)).toBe('3.0 MB');
	expect(formatSize(150 * 1024)).toBe('150 KB');
});

// --- fixture -------------------------------------------------------------

const root = mkdtempSync(join(tmpdir(), 'workbench-test-'));
const project = join(root, 'project');
const plain = join(root, 'plain');
const data = join(root, 'data');
const LONG = Array.from({length: 60}, (_, index) => `line ${index + 1}`).join('\n') + '\n';

async function sh(cwd: string, argv: string[]) {
	// No user or system git config: no signing, hooks or templates in the fixture.
	const proc = Bun.spawn(argv, {cwd, env: {...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1'}, stdout: 'pipe', stderr: 'pipe'});
	if (await proc.exited !== 0) throw new Error(`${argv.join(' ')}: ${await new Response(proc.stderr).text()}`);
}

beforeAll(async () => {
	mkdirSync(join(project, 'src'), {recursive: true});
	mkdirSync(join(project, 'node_modules', 'dep'), {recursive: true});
	mkdirSync(plain);
	mkdirSync(data);
	writeFileSync(join(project, 'README.md'), '# Fixture\n\nFirst version.\n');
	writeFileSync(join(project, 'src', 'index.ts'), 'export const answer = 42;\n');
	writeFileSync(join(project, 'long.txt'), LONG);
	writeFileSync(join(project, 'blob.bin'), new Uint8Array([1, 2, 0, 3, 0, 4]));
	const png = new PNG({width: 4, height: 4});
	png.data.fill(255);
	writeFileSync(join(project, 'logo.png'), PNG.sync.write(png));
	writeFileSync(join(project, 'package.json'), JSON.stringify({
		name: 'fixture',
		scripts: {hi: 'echo hi-from-task', fail: 'echo boom; exit 3', slow: 'sleep 0.6 && echo slow-done', hang: 'sleep 30'},
	}, null, 2));
	writeFileSync(join(project, 'Makefile'), 'build:\n\t@echo built\n.PHONY: build\n');
	writeFileSync(join(project, 'node_modules', 'dep', 'index.js'), '');
	writeFileSync(join(plain, 'note.txt'), 'not a repo\n');
	await sh(project, ['git', 'init', '-q', '-b', 'main']);
	writeFileSync(join(project, '.gitignore'), 'node_modules/\n');
	await sh(project, ['git', 'add', '-A']);
	await sh(project, ['git', '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init']);
	// Staged and then changed again, changed only, untracked.
	writeFileSync(join(project, 'README.md'), '# Fixture\n\nSecond version.\n');
	await sh(project, ['git', 'add', 'README.md']);
	writeFileSync(join(project, 'README.md'), '# Fixture\n\nThird version.\n');
	writeFileSync(join(project, 'src', 'index.ts'), 'export const answer = 43;\n');
	writeFileSync(join(project, 'todo.txt'), 'untracked line\n');
});

afterAll(() => rmSync(root, {recursive: true, force: true}));

/** Never the real lsof: dd in a test must not stop a real process. */
function fakePorts(ports: Port[] = []) {
	const stopped: number[] = [];
	let lists = 0;
	let fail: Error | undefined;
	const source: PortSource = {
		list: async () => {
			lists++;
			return ports;
		},
		stop: pid => {
			if (fail) throw fail;
			stopped.push(pid);
		},
	};
	return {source, stopped, lists: () => lists, failWith: (error: Error) => {
		fail = error;
	}};
}

const open = (cwd = project, options: {dataDir?: string; ports?: PortSource; cols?: number; rows?: number} = {}) => headless(
	<Workbench cwd={cwd} ports={options.ports ?? fakePorts().source} {...(options.dataDir ? {dataDir: options.dataDir} : {})} />,
	{cols: options.cols ?? 120, rows: options.rows ?? 24},
);

// --- files ---------------------------------------------------------------

test('listDir: folders first, by name, without .git and node_modules', async () => {
	const nodes = await listDir(project);
	expect(nodes.map(node => node.label)).toEqual(['src/', '.gitignore', 'blob.bin', 'logo.png', 'long.txt', 'Makefile', 'package.json', 'README.md', 'todo.txt']);
	expect(nodes[0]!.load).toBeDefined();
	expect(nodes[1]!.load).toBeUndefined();
}, 20_000);

test('readPreview: text, a cut huge file, binary, image, missing', async () => {
	expect(await readPreview(join(project, 'long.txt'))).toMatchObject({kind: 'text', size: LONG.length, lines: 60, truncated: false});
	const empty = join(root, 'empty.txt');
	writeFileSync(empty, '');
	expect(await readPreview(empty)).toMatchObject({kind: 'text', lines: 0});
	const huge = join(root, 'huge.txt');
	writeFileSync(huge, 'x'.repeat(99) + '\n'.repeat(1) + 'y'.repeat(TEXT_CAP));
	const cut = await readPreview(huge);
	expect(cut).toMatchObject({kind: 'text', truncated: true});
	expect(cut.kind === 'text' && cut.text).toBe('x'.repeat(99) + '\n');
	expect(await readPreview(join(project, 'blob.bin'))).toEqual({kind: 'note', path: join(project, 'blob.bin'), note: 'Binary file, 6 B: no preview'});
	expect(await readPreview(join(project, 'logo.png'))).toMatchObject({kind: 'image'});
	expect(await readPreview(join(project, 'nothing.txt'))).toMatchObject({kind: 'note', note: 'Cannot read: file not found'});
}, 20_000);

test('files tab: tree of the folder, Enter previews, Ctrl-w moves to the preview', async () => {
	const app = await open();
	await until(app, 'package.json');
	expect(app.screen()).toContain('workbench · project (main)');
	expect(app.screen()).not.toContain('node_modules');
	expect(app.screen()).not.toContain('.git/');
	expect(app.screen()).toContain('Open a file with Enter to see it here.');
	// src/ .gitignore blob.bin logo.png long.txt
	await app.press('4j<CR>');
	await until(app, 'long.txt  471 B · 60 lines');
	expect(app.screen()).toContain('line 1 ');
	await app.press('<C-w>w5j');
	expect(app.screen()).toMatch(/6-\d+\/60/);
	expect(app.screen()).not.toContain('│line 1 ');
	// Back in the tree, j moves the cursor again, not the text.
	await app.press('<C-w>wj<CR>');
	await until(app, 'Makefile  ');
	expect(app.screen()).toContain('@echo built');
	await app.exit();
}, 20_000);

test('files tab: folders load when opened, images and binaries preview', async () => {
	const app = await open();
	await until(app, 'package.json');
	await app.press('l');
	await until(app, 'index.ts');
	await app.press('j<CR>');
	await until(app, 'export const answer');
	await app.press('ggh');
	expect(app.screen()).toContain('▸ src/');
	await app.press('3j<CR>');
	await until(app, 'logo.png  ');
	expect(app.screen()).toContain('image');
	expect(app.screen()).toMatch(/[▀▄█]/);
	await app.press('k<CR>');
	await until(app, 'Binary file, 6 B: no preview');
	await app.exit();
}, 20_000);

// --- git -----------------------------------------------------------------

test('git tab: branch, changed files, and the diff of the highlighted one', async () => {
	const app = await open();
	await app.press('gt');
	await until(app, 'Branch main, no upstream');
	expect(app.screen()).toContain('3 changed, 1 staged, 1 untracked');
	expect(app.screen()).toContain('MM  README.md');
	expect(app.screen()).toContain('·M  src/index.ts');
	expect(app.screen()).toContain('??  todo.txt');
	// README.md is staged and changed again: both parts show.
	await until(app, '── Staged ──');
	await until(app, '+Second version.');
	await app.press('<C-w>wG');
	await until(app, '+Third version.');
	expect(app.screen()).toContain('── Unstaged ──');
	await app.press('<C-w>wj');
	await until(app, '+export const answer = 43;');
	expect(app.screen()).not.toContain('── Staged ──');
	await app.press('j');
	await until(app, '── Untracked ──');
	await until(app, '+untracked line');
	await app.exit();
}, 20_000);

test('git tab: r refreshes; a folder outside git says so', async () => {
	const app = await open();
	await app.press('gt');
	await until(app, '3 changed');
	writeFileSync(join(project, 'later.txt'), 'later\n');
	await app.press('r');
	await until(app, '4 changed');
	rmSync(join(project, 'later.txt'));
	await app.exit();

	const outside = await open(plain);
	await outside.press('gt');
	await until(outside, `Not a git repository: ${plain}`);
	expect(outside.screen()).toContain('workbench · plain');
	expect(outside.screen()).not.toContain('(main)');
	await outside.exit();
}, 20_000);

// --- tasks ---------------------------------------------------------------

test('tasks tab: scripts and make targets; Enter runs one and notifies the result', async () => {
	const app = await open();
	await app.press('3gt');
	await until(app, 'echo hi-from-task');
	expect(app.screen()).toContain('build make');
	expect(app.screen()).toContain('Nothing run yet.');
	await app.press('<CR>');
	await until(app, 'hi: done (exit 0)');
	expect(app.screen()).toContain('$ bun run hi');
	expect(app.screen()).toContain('exit 0');
	expect(app.screen()).toContain('hi-from-task');

	await app.press('j<CR>');
	await until(app, 'fail: failed (exit 3)');
	expect(app.screen()).toContain('boom');
	// The error stays until Esc; r runs the last task again.
	await app.press('<Esc>');
	expect(app.screen()).not.toContain('fail: failed');
	await app.press('r');
	await until(app, 'fail: failed (exit 3)');

	await app.press('<Esc>G<CR>');
	await until(app, 'make build');
	await until(app, 'build: done (exit 0)');
	expect(app.screen()).toContain('built');
	await app.exit();
}, 20_000);

test('tasks tab: a task keeps running on another tab, then notifies; Ctrl-k stops one', async () => {
	const app = await open();
	await app.press('3gt');
	await until(app, 'sleep 0.6');
	await app.press('2j<CR>');
	await until(app, 'running');
	expect(app.screen()).toContain('Tasks ●');
	expect(app.screen()).toContain('running slow');
	// Off to Files while it runs: the notification still comes.
	await app.press('1gt');
	await until(app, 'Enter opens a file');
	await until(app, 'slow: done (exit 0)');
	expect(app.screen()).not.toContain('Tasks ●');
	await app.press('3gt');
	await until(app, 'slow-done');

	await app.press('3j<CR>');
	await until(app, 'running hang');
	await app.press('<C-k>');
	await until(app, 'hang: stopped (SIGTERM)');
	expect(app.screen()).toContain('stopped (SIGTERM)');
	await app.exit();
}, 20_000);

test('tasks tab: a folder without tasks says so', async () => {
	const app = await open(plain);
	await app.press('3gt');
	// The message wraps in the narrow pane.
	await until(app, 'No package.json scripts or Makefile');
	await app.exit();
}, 20_000);

// --- ports ---------------------------------------------------------------

const PORTS: Port[] = [
	{command: 'node', pid: 4242, user: 'me', address: '127.0.0.1:3000', port: 3000},
	{command: 'postgres', pid: 301, user: '_postgres', address: '127.0.0.1:5432', port: 5432},
];

test('ports tab: dd asks first; no keeps it, yes sends SIGTERM to the highlighted pid', async () => {
	const fake = fakePorts(PORTS);
	const app = await open(project, {ports: fake.source});
	await app.press('4gt');
	await until(app, 'postgres');
	expect(app.screen()).toMatch(/node +4242 me +127\.0\.0\.1:3000/);
	await app.press('jdd');
	expect(app.screen()).toContain('Send SIGTERM to postgres (pid 301, 127.0.0.1:5432)?');
	await app.press('n');
	expect(app.screen()).not.toContain('Send SIGTERM');
	expect(fake.stopped).toEqual([]);
	await app.press('kdd');
	expect(app.screen()).toContain('Send SIGTERM to node (pid 4242, 127.0.0.1:3000)?');
	const before = fake.lists();
	await app.press('y');
	expect(fake.stopped).toEqual([4242]);
	await until(app, 'Sent SIGTERM to node (pid 4242)');
	// The list is read again once the process had time to exit.
	await app.settle(500);
	expect(fake.lists()).toBe(before + 1);
	await app.exit();
}, 20_000);

test('ports tab: a failed stop is an error, r refreshes, an empty filter stops nothing', async () => {
	const fake = fakePorts(PORTS);
	const app = await open(project, {ports: fake.source});
	await app.press('4gt');
	await until(app, 'postgres');
	fake.failWith(Object.assign(new Error('kill ESRCH'), {code: 'ESRCH'}));
	await app.press('ddy');
	await until(app, 'Could not stop node (pid 4242): it already exited');
	// Let the read after the stop happen first.
	await app.settle(500);
	const before = fake.lists();
	await app.press('<Esc>r');
	await app.settle(50);
	expect(fake.lists()).toBe(before + 1);
	// A filter that matches nothing leaves no highlighted row for dd.
	await app.press('/nothing-matches<CR>dd');
	expect(app.screen()).not.toContain('Send SIGTERM');
	await app.exit();

	const empty = await open(project, {ports: fakePorts([]).source});
	await empty.press('4gt');
	await until(empty, 'Nothing listens on TCP.');
	await empty.exit();
}, 20_000);

// --- app -----------------------------------------------------------------

test('the last open tab is remembered per folder', async () => {
	expect(loadLastTab(undefined, project)).toBeUndefined();
	const first = await open(project, {dataDir: data});
	await first.press('2gt');
	await until(first, 'Branch main');
	await first.exit();
	expect(loadLastTab(data, project)).toBe('git');

	const again = await open(project, {dataDir: data});
	await until(again, 'Branch main');
	await again.exit();
	// Another folder starts on Files.
	const other = await open(plain, {dataDir: data});
	await until(other, 'Enter opens a file');
	await other.exit();

	saveLastTab(data, plain, 'ports');
	expect(loadLastTab(data, plain)).toBe('ports');
	expect(loadLastTab(data, project)).toBe('git');
	writeFileSync(join(data, 'last-tab.json'), '{broken');
	expect(loadLastTab(data, project)).toBeUndefined();
	saveLastTab(join(root, 'no-such-dir'), project, 'git');
}, 20_000);

test('help lists the keys of the open tab; q quits', async () => {
	const app = await open(project, {rows: 44});
	await until(app, 'package.json');
	await app.press('?');
	expect(app.screen()).toContain('Read the folder again');
	await app.press('<Esc>4gt');
	await app.press('?');
	expect(app.screen()).toContain('Stop the process (SIGTERM), after a yes');
	expect(app.screen()).toContain('Read the ports again');
	await app.press('<Esc>q');
	expect(app.exited()).toBe(true);
	await app.exit();
}, 20_000);

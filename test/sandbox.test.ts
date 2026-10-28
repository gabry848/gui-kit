// The macOS sandbox, end to end: apps started with the CLI from folders in a
// throwaway HOME. Only darwin enforces permissions, so elsewhere these skip.

import {afterAll, expect, test} from 'bun:test';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const darwin = process.platform === 'darwin';
const home = mkdtempSync(join(tmpdir(), 'gui-sandbox-test-'));
const guiHome = join(home, 'gui');
const gui = join(import.meta.dir, '..', 'bin', 'gui');
afterAll(() => rmSync(home, {recursive: true, force: true}));

/** The test's environment without what would change git or the folders the CLI picks. */
function baseEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && !key.startsWith('GIT_') && key !== 'XDG_CONFIG_HOME' && key !== 'XDG_DATA_HOME') env[key] = value;
	}
	return env;
}

async function cli(args: string[], cwd = home, env: Record<string, string> = {}) {
	const proc = Bun.spawn([gui, ...args], {cwd, env: {...baseEnv(), HOME: home, GUI_HOME: guiHome, ...env}, stdout: 'pipe', stderr: 'pipe'});
	const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	return {stdout, stderr, code};
}

function writeApp(dir: string, manifest: object, source: string) {
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, 'gui.json'), JSON.stringify(manifest));
	writeFileSync(join(dir, 'app.tsx'), source);
}

/** An app that shows `results` (an expression building a string) on one line. */
function probeApp(setup: string, results: string): string {
	return `import {readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {Shell, Text} from 'gui-kit';
const attempt = (action: () => unknown) => { try { const value = action(); return value === undefined ? 'ok' : String(value); } catch (error) { return (error as NodeJS.ErrnoException).code ?? 'failed'; } };
${setup}
const line = ${results};
export default function App() {
	return <Shell title="probe"><Text>{line}</Text></Shell>;
}
`;
}

test.skipIf(!darwin)('a {} app starts from a folder in HOME it may not read: it lists the folder, reads no file in it and gets no .env', async () => {
	// Right below HOME: deeper down, Bun sometimes skips a .env it cannot read instead of dying.
	const project = join(home, 'project');
	mkdirSync(join(project, 'sub'), {recursive: true});
	writeFileSync(join(project, 'package.json'), '{"name": "project"}\n');
	writeFileSync(join(project, 'tsconfig.json'), '{"compilerOptions": {"strict": true}}\n');
	writeFileSync(join(project, 'bunfig.toml'), '[run]\n');
	writeFileSync(join(project, '.env'), 'GUI_TEST_SECRET=leaked\n');
	writeFileSync(join(project, 'notes.txt'), 'private');
	const app = join(home, 'apps', 'lister');
	writeApp(app, {name: 'lister', entry: 'app.tsx', permissions: {}}, probeApp('',
		"`cwd=${process.cwd()} list=${attempt(() => readdirSync('.').length)} notes=${attempt(() => readFileSync('notes.txt', 'utf8'))} env=${process.env.GUI_TEST_SECRET}`"));
	// Before, Bun died at startup with "An unknown error occurred (Unexpected)".
	const screen = await cli(['screen', app, '--cols', '250', '--rows', '6'], project);
	expect(screen.stderr).toBe('');
	expect(screen.code).toBe(0);
	expect(screen.stdout).toContain(`cwd=${realpathSync(project)} list=6 notes=EPERM env=undefined`);
	const deeper = await cli(['screen', app, '--cols', '250', '--rows', '6'], join(project, 'sub'));
	expect(deeper.code).toBe(0);
	expect(deeper.stdout).toContain(`cwd=${realpathSync(join(project, 'sub'))} list=0`);
	const check = await cli(['check', app], project);
	expect(check.stdout).toContain('starts and draws');
	expect(check.code).toBe(0);
}, 60_000);

test.skipIf(!darwin)('net false also blocks unix sockets, "local" allows only localhost and true allows both; bun itself always runs', async () => {
	const socketPath = `/tmp/gui-sandbox-${process.pid}.sock`;
	rmSync(socketPath, {force: true});
	const unix = Bun.listen({unix: socketPath, socket: {data(socket, data) {
		socket.write('pong:' + String(data));
	}}});
	const server = Bun.serve({port: 0, hostname: '127.0.0.1', fetch: () => new Response('pong')});
	const setup = `const unix = await new Promise<string>(resolve => {
	setTimeout(() => resolve('timeout'), 3000);
	Bun.connect({unix: ${JSON.stringify(socketPath)}, socket: {
		open(socket) { socket.write('ping'); },
		data(socket, data) { resolve(String(data)); socket.end(); },
		connectError() { resolve('failed'); },
		error() { resolve('failed'); },
	}}).catch(() => resolve('failed'));
});
const ip = await fetch('http://127.0.0.1:${server.port}/').then(response => response.text(), () => 'failed');
const bun = attempt(() => Bun.spawnSync([process.execPath, '--version']).success ? 'ok' : 'failed');`;
	const source = probeApp(setup, '`unix=${unix} ip=${ip} bun=${bun}`');
	try {
		const cases: [{net?: 'local' | true}, string][] = [[{}, 'unix=failed ip=failed bun=ok'], [{net: 'local'}, 'unix=failed ip=pong bun=ok'], [{net: true}, 'unix=pong:ping ip=pong bun=ok']];
		for (const [permissions, expected] of cases) {
			const dir = join(home, 'apps', `net-${String(permissions.net ?? 'none')}`);
			writeApp(dir, {name: 'net', entry: 'app.tsx', permissions}, source);
			const screen = await cli(['screen', dir, '--cols', '120', '--rows', '6']);
			expect(screen.stdout).toContain(expected);
		}
	} finally {
		server.stop(true);
		unix.stop(true);
		rmSync(socketPath, {force: true});
	}
}, 60_000);

test.skipIf(!darwin || !Bun.which('git'))('run: ["git"] may read ~/.gitconfig and ~/.config/git; $REPO is the work tree', async () => {
	writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Sandbox Test\n');
	mkdirSync(join(home, '.config', 'git'), {recursive: true});
	writeFileSync(join(home, '.config', 'git', 'ignore'), 'ignored.txt\n');
	const repo = join(home, 'repo');
	mkdirSync(join(repo, 'sub'), {recursive: true});
	expect(Bun.spawnSync(['git', 'init', '-q', repo], {env: {...baseEnv(), HOME: home}}).success).toBe(true);
	writeFileSync(join(repo, 'tracked.txt'), 'a');
	writeFileSync(join(repo, 'ignored.txt'), 'b');
	const setup = `const git = (...args: string[]) => { const proc = Bun.spawnSync(['git', ...args]); return \`\${proc.exitCode}:\${proc.stdout.toString().trim().split('\\n').join(',')}\`; };`;
	const source = probeApp(setup, "`status=${git('status', '--short')} name=${git('config', 'user.name')}`");
	const dir = join(home, 'apps', 'gitview');
	writeApp(dir, {name: 'gitview', entry: 'app.tsx', permissions: {read: ['$REPO'], run: ['git']}}, source);
	// Before, git stopped with "fatal: unable to access '~/.gitconfig'" and exit 128.
	const screen = await cli(['screen', dir, '--cols', '160', '--rows', '6'], join(repo, 'sub'));
	expect(screen.stdout).toContain('status=0:?? ../tracked.txt name=0:Sandbox Test');
}, 60_000);

test.skipIf(!darwin)('an app writes in HOME and GUI_HOME only where it may, even when both are in a temp folder', async () => {
	const work = join(home, 'work', 'writes');
	mkdirSync(work, {recursive: true});
	const setup = 'const guiHome = dirname(dirname(process.env.GUI_DATA_DIR!));';
	const source = probeApp(setup, `\`home=\${attempt(() => writeFileSync(${JSON.stringify(join(home, 'home-write.txt'))}, 'x'))} registry=\${attempt(() => writeFileSync(join(guiHome, 'registry.json'), '{}'))} data=\${attempt(() => writeFileSync(join(process.env.GUI_DATA_DIR!, 'state.json'), '{}'))} cwd=\${attempt(() => writeFileSync('out.txt', 'x'))} tmp=\${attempt(() => writeFileSync(join(${JSON.stringify(realpathSync(tmpdir()))}, 'gui-sandbox-${process.pid}.txt'), 'x'))}\``);
	try {
		// Before, a HOME under /private/var/folders was writable as a whole.
		writeApp(join(home, 'apps', 'writer'), {name: 'writer', entry: 'app.tsx', permissions: {}}, source);
		const boxed = await cli(['screen', join(home, 'apps', 'writer'), '--cols', '160', '--rows', '6'], work);
		expect(boxed.stdout).toContain('home=EPERM registry=EPERM data=ok cwd=EPERM tmp=ok');

		writeApp(join(home, 'apps', 'cwd-writer'), {name: 'cwd-writer', entry: 'app.tsx', permissions: {write: ['$CWD']}}, source);
		const allowed = await cli(['screen', join(home, 'apps', 'cwd-writer'), '--cols', '160', '--rows', '6'], work);
		expect(allowed.stdout).toContain('home=EPERM registry=EPERM data=ok cwd=ok tmp=ok');

		// A GUI_HOME outside HOME, as in GUI_HOME=$(mktemp -d)/gui: its registry stays out of reach.
		const otherGui = join(mkdtempSync(join(tmpdir(), 'gui-sandbox-home-')), 'gui');
		try {
			const outside = await cli(['screen', join(home, 'apps', 'writer'), '--cols', '160', '--rows', '6'], work, {GUI_HOME: otherGui});
			expect(outside.stdout).toContain('home=EPERM registry=EPERM data=ok cwd=EPERM tmp=ok');
		} finally {
			rmSync(join(otherGui, '..'), {recursive: true, force: true});
		}
	} finally {
		rmSync(join(realpathSync(tmpdir()), `gui-sandbox-${process.pid}.txt`), {force: true});
	}
}, 60_000);

test.skipIf(!darwin)('bun run works inside the sandbox from a folder deep in HOME: the folders above it may be listed, not read', async () => {
	// bun run lists every folder above the one it starts in, looking for a workspace root.
	const outer = join(home, 'deep', 'workspace');
	const project = join(outer, 'packages', 'tool');
	mkdirSync(project, {recursive: true});
	writeFileSync(join(outer, 'package.json'), '{"name": "outer", "workspaces": ["packages/*"]}\n');
	writeFileSync(join(outer, 'secret.txt'), 'private');
	writeFileSync(join(project, 'package.json'), '{"name": "tool", "scripts": {"hi": "echo hi-from-script"}}\n');
	const app = join(home, 'apps', 'runner');
	writeApp(app, {name: 'runner', entry: 'app.tsx', permissions: {write: ['$CWD'], run: ['*']}}, probeApp(
		`const run = Bun.spawnSync(['bun', 'run', 'hi'], {stderr: 'pipe'});`,
		`'script=' + (run.stdout.toString().includes('hi-from-script') ? 'ok' : run.stderr.toString().trim().split('\\n').pop()) + ' above=' + attempt(() => readFileSync(${JSON.stringify(join(outer, 'secret.txt'))}, 'utf8'))`,
	));
	const screen = await cli(['screen', app, '--cols', '160', '--rows', '6'], project);
	expect(screen.stdout).toContain('script=ok above=EPERM');
}, 60_000);

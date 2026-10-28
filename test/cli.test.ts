import {afterAll, expect, test} from 'bun:test';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// The CLI runs with a throwaway HOME so it never touches the real registry.
const home = mkdtempSync(join(tmpdir(), 'gui-cli-test-'));
const guiHome = join(home, 'gui');
const kit = join(import.meta.dir, '..');
const gui = join(kit, 'bin', 'gui');
const version = (JSON.parse(readFileSync(join(kit, 'package.json'), 'utf8')) as {version: string}).version;
afterAll(() => rmSync(home, {recursive: true, force: true}));

async function cli(args: string[], env: Record<string, string> = {}) {
	const proc = Bun.spawn([gui, ...args], {cwd: home, env: {...process.env, HOME: home, GUI_HOME: guiHome, ...env}, stdout: 'pipe', stderr: 'pipe'});
	const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	return {stdout, stderr, code};
}

function writeApp(dir: string, manifest: object, source: string) {
	mkdirSync(dir, {recursive: true});
	writeFileSync(join(dir, 'gui.json'), JSON.stringify(manifest));
	writeFileSync(join(dir, 'app.tsx'), source);
}

const SHOW_ENV = `import {Shell, Text} from 'gui-kit';
export default function App() {
	return <Shell title="env"><Text>{'node_path=' + process.env.NODE_PATH + ' data=' + process.env.GUI_DATA_DIR}</Text></Shell>;
}
`;

test('new, ls, screen and uninstall an app', async () => {
	expect((await cli(['new', 'sample', '--description', 'A sample app'])).code).toBe(0);
	expect((await cli(['ls'])).stdout).toContain('A sample app');
	const screen = await cli(['screen', 'sample', '--cols', '60', '--rows', '8', '--keys', 'j<CR>']);
	expect(screen.stdout).toContain('Second');
	expect(screen.stdout).toContain('[finish] "Second"');
	expect((await cli(['uninstall', 'sample'])).code).toBe(0);
	expect((await cli(['ls'])).stdout).toContain('No apps installed');
	expect(existsSync(join(home, 'sample', 'app.tsx'))).toBe(true);
}, 30_000);

test('install --bin writes a launcher that uninstall removes', async () => {
	await cli(['new', 'launchable']);
	expect((await cli(['install', 'launchable', '--bin'])).code).toBe(0);
	const bin = join(home, '.local', 'bin', 'launchable');
	expect(existsSync(bin)).toBe(true);
	await cli(['uninstall', 'launchable']);
	expect(existsSync(bin)).toBe(false);
}, 30_000);

test('screen runs a one-off file from any folder', async () => {
	const file = join(home, 'question.tsx');
	writeFileSync(file, `import {Confirm, Shell, useFinish} from 'gui-kit';
export default function App() {
	const finish = useFinish();
	return <Shell title="Question"><Confirm question="All good?" onAnswer={finish} /></Shell>;
}
`);
	const screen = await cli(['screen', file, '--cols', '50', '--rows', '6', '--keys', 'y']);
	expect(screen.stdout).toContain('All good?');
	expect(screen.stdout).toContain('[finish] true');
	expect((await cli(['check', file])).code).toBe(0);
}, 30_000);

test('unknown app fails with a hint', async () => {
	const result = await cli(['no-such-app']);
	expect(result.code).toBe(2);
	expect(result.stderr).toContain('gui ls');
});

test('names of subcommands are refused, and check catches a missing default export', async () => {
	const reserved = await cli(['new', 'run']);
	expect(reserved.code).toBe(2);
	expect(reserved.stderr).toContain('gui command');
	const file = join(home, 'no-default.tsx');
	writeFileSync(file, `import {Shell, Text} from 'gui-kit';
export function App() {
	return <Shell title="x"><Text>hello</Text></Shell>;
}
`);
	const check = await cli(['check', file]);
	expect(check.stdout).toContain('types ok');
	expect(check.code).toBe(2);
	expect(check.stderr).toContain('default-export');
}, 30_000);

test('screen passes arguments and reports an app that quit', async () => {
	const file = join(home, 'arguments.tsx');
	writeFileSync(file, `import {Shell, Text} from 'gui-kit';
export default function App() {
	const args = JSON.parse(process.env.GUI_ARGS ?? '[]') as string[];
	return <Shell title="args"><Text>{'arguments: ' + args.join(',')}</Text></Shell>;
}
`);
	const screen = await cli(['screen', file, 'one', 'two', '--keys', 'q', '--cols', '60', '--rows', '6']);
	expect(screen.stdout).toContain('arguments: one,two');
	expect(screen.stdout).toContain('[exit]');
}, 30_000);

test('new never overwrites, install never moves a name, launchers survive a reinstall', async () => {
	const kept = join(home, 'keep');
	await cli(['new', 'tmp-keep', '--dir', kept]);
	const clash = await cli(['new', 'other', '--dir', kept]);
	expect(clash.code).toBe(2);
	expect(clash.stderr).toContain('never overwrites');

	const missingFrom = await cli(['new', 'from-nothing', '--dir', join(home, 'nothing'), '--from', join(home, 'missing.tsx')]);
	expect(missingFrom.code).toBe(2);
	expect(existsSync(join(home, 'nothing', 'gui.json'))).toBe(false);

	const moved = await cli(['new', 'tmp-keep', '--dir', join(home, 'elsewhere')]);
	expect(moved.code).toBe(2);
	expect(moved.stderr).toContain('already installed');

	expect((await cli(['install', kept, '--bin'])).code).toBe(0);
	expect((await cli(['install', kept])).code).toBe(0);
	const bin = join(home, '.local', 'bin', 'tmp-keep');
	expect(existsSync(bin)).toBe(true);
	await cli(['uninstall', 'tmp-keep']);
	expect(existsSync(bin)).toBe(false);
}, 60_000);

test('an installed name wins over a folder of the same name; -- passes arguments verbatim', async () => {
	await cli(['new', 'namesake', '--dir', join(home, 'real')]);
	mkdirSync(join(home, 'namesake'), {recursive: true});
	const screen = await cli(['screen', 'namesake', '--cols', '50', '--rows', '6']);
	expect(screen.code).toBe(0);
	expect(screen.stdout).toContain('First');

	const file = join(home, 'arguments2.tsx');
	writeFileSync(file, `import {Shell, Text} from 'gui-kit';
export default function App() {
	return <Shell title="a"><Text>{'args=' + (process.env.GUI_ARGS ?? '')}</Text></Shell>;
}
`);
	const passed = await cli(['screen', file, '--rows', '6', '--', '--keys', 'x']);
	expect(passed.stdout).toContain('args=["--keys","x"]');
}, 30_000);

test('an installed app runs on its saved kit copy, from its name or its folder; a file runs on this kit', async () => {
	writeApp(join(home, 'pinned'), {name: 'pinned', entry: 'app.tsx', kit: `^${version}`, permissions: {}}, SHOW_ENV);
	expect((await cli(['install', join(home, 'pinned')])).code).toBe(0);
	expect(existsSync(join(guiHome, 'kits', version, 'package.json'))).toBe(true);
	const registry = JSON.parse(readFileSync(join(guiHome, 'registry.json'), 'utf8')) as {apps: Record<string, {kit: string}>};
	expect(registry.apps['pinned']!.kit).toBe(version);

	const byName = await cli(['screen', 'pinned', '--cols', '200', '--rows', '6']);
	expect(byName.stdout).toContain(join(guiHome, 'kits', version, 'runtime', 'node_modules'));
	expect(byName.stdout).toContain(`data=${join(guiHome, 'data', 'pinned')}`);
	// The folder links that copy, so running it from there gives the same kit.
	const byFolder = await cli(['screen', join(home, 'pinned'), '--cols', '200', '--rows', '6']);
	expect(byFolder.stdout).toContain(join(guiHome, 'kits', version, 'runtime', 'node_modules'));
	writeFileSync(join(home, 'show-env.tsx'), SHOW_ENV);
	const file = await cli(['screen', join(home, 'show-env.tsx'), '--cols', '200', '--rows', '6']);
	expect(file.stdout).toContain(join(kit, 'runtime', 'node_modules'));
	expect((await cli(['kits'])).stdout).toContain('pinned');
}, 60_000);

test('an app asking for a kit nobody has is refused', async () => {
	writeApp(join(home, 'future'), {name: 'future', entry: 'app.tsx', kit: '^99.0.0', permissions: {}}, SHOW_ENV);
	const screen = await cli(['screen', join(home, 'future')]);
	expect(screen.code).toBe(2);
	expect(screen.stderr).toContain('needs gui-kit ^99.0.0');
	expect((await cli(['install', join(home, 'future')])).code).toBe(2);
});

test('install asks to approve permissions, and an app asking for more later stops', async () => {
	const dir = join(home, 'asking');
	writeApp(dir, {name: 'asking', entry: 'app.tsx', kit: `^${version}`, permissions: {run: ['echo']}}, SHOW_ENV);
	const refused = await cli(['install', dir]);
	expect(refused.code).toBe(2);
	expect(refused.stderr).toContain('run    echo');
	expect(refused.stderr).toContain('--yes');
	expect(existsSync(join(guiHome, 'registry.json')) && readFileSync(join(guiHome, 'registry.json'), 'utf8').includes('"asking"')).toBe(false);

	expect((await cli(['install', dir, '--yes'])).code).toBe(0);
	// Reinstalling with the same permissions asks nothing.
	expect((await cli(['install', dir])).code).toBe(0);
	expect((await cli(['screen', 'asking', '--rows', '6'])).code).toBe(0);

	writeFileSync(join(dir, 'gui.json'), JSON.stringify({name: 'asking', entry: 'app.tsx', kit: `^${version}`, permissions: {run: ['echo'], net: true}}));
	const grown = await cli(['screen', 'asking', '--rows', '6']);
	expect(grown.code).toBe(2);
	expect(grown.stderr).toContain('now asks for more');
	expect(grown.stderr).toContain('net    any host');
}, 60_000);

test.skipIf(process.platform !== 'darwin')('the sandbox enforces read, write, run and net', async () => {
	const secret = join(home, 'secret.txt');
	writeFileSync(secret, 'secret');
	const outside = join(kit, `.sandbox-write-test-${process.pid}`);
	const server = Bun.serve({port: 0, hostname: '127.0.0.1', fetch: () => new Response('pong')});
	const source = `import {readFileSync, writeFileSync} from 'node:fs';
import {Shell, Text} from 'gui-kit';
const attempt = (action: () => unknown) => { try { action(); return 'ok'; } catch (error) { return (error as NodeJS.ErrnoException).code ?? 'failed'; } };
const read = attempt(() => readFileSync(${JSON.stringify(secret)}));
const write = attempt(() => writeFileSync(${JSON.stringify(outside)}, 'x'));
const data = attempt(() => writeFileSync(process.env.GUI_DATA_DIR + '/state.json', '{}'));
const run = attempt(() => { if (!Bun.spawnSync(['echo', 'hi']).success) throw new Error(); });
const net = await fetch('http://127.0.0.1:${server.port}/').then(() => 'ok', () => 'failed');
export default function App() {
	return <Shell title="sandbox"><Text>{\`read=\${read} write=\${write} data=\${data} run=\${run} net=\${net}\`}</Text></Shell>;
}
`;
	try {
		writeApp(join(home, 'boxed'), {name: 'boxed', entry: 'app.tsx', permissions: {}}, source);
		const boxed = await cli(['screen', join(home, 'boxed'), '--cols', '120', '--rows', '6']);
		expect(boxed.stdout).toContain('read=EPERM write=EPERM data=ok run=EPERM net=failed');

		writeApp(join(home, 'trusted'), {name: 'trusted', entry: 'app.tsx', permissions: {read: [secret], run: ['echo'], net: 'local'}}, source);
		const trusted = await cli(['screen', join(home, 'trusted'), '--cols', '120', '--rows', '6']);
		expect(trusted.stdout).toContain('read=ok write=EPERM data=ok run=ok net=ok');

		writeApp(join(home, 'full'), {name: 'full', entry: 'app.tsx'}, source.replace(JSON.stringify(outside), JSON.stringify(join(home, 'full-write.txt'))));
		const full = await cli(['screen', join(home, 'full'), '--cols', '120', '--rows', '6']);
		expect(full.stdout).toContain('read=ok write=ok data=ok run=ok net=ok');
	} finally {
		server.stop(true);
		rmSync(outside, {force: true});
	}
	expect(existsSync(outside)).toBe(false);
}, 60_000);

test('scratch files, keep and gc', async () => {
	const first = (await cli(['scratch', 'pick'])).stdout.trim();
	const second = (await cli(['scratch', 'pick'])).stdout.trim();
	expect(first).toBe(join(guiHome, 'scratch', 'pick.tsx'));
	expect(second).toBe(join(guiHome, 'scratch', 'pick-2.tsx'));
	const screen = await cli(['screen', first, '--rows', '8', '--keys', '<CR>']);
	expect(screen.stdout).toContain('[finish] true');
	expect((await cli(['ls'])).stdout).toContain('pick-2.tsx');

	const kept = await cli(['keep', second, 'picker', '--dir', join(home, 'picker')]);
	expect(kept.code).toBe(0);
	expect(existsSync(second)).toBe(false);
	expect(existsSync(join(home, 'picker', 'app.tsx'))).toBe(true);
	expect((await cli(['screen', 'picker', '--rows', '8', '--keys', 'j<CR>'])).stdout).toContain('[finish] false');

	const old = new Date(Date.now() - 10 * 86_400_000);
	utimesSync(first, old, old);
	const dry = await cli(['gc', '--dry-run']);
	expect(dry.stdout).toContain('would delete');
	expect(existsSync(first)).toBe(true);
	await cli(['gc']);
	expect(existsSync(first)).toBe(false);
	// Kit copies stay while an installed app uses them.
	expect(existsSync(join(guiHome, 'kits', version))).toBe(true);
}, 60_000);

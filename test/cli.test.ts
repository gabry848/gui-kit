import {afterAll, expect, test} from 'bun:test';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expandPath} from '../src/cli/permissions.js';

// The CLI runs with a throwaway HOME so it never touches the real registry.
const home = mkdtempSync(join(tmpdir(), 'gui-cli-test-'));
const guiHome = join(home, 'gui');
const kit = join(import.meta.dir, '..');
const gui = join(kit, 'bin', 'gui');
const version = (JSON.parse(readFileSync(join(kit, 'package.json'), 'utf8')) as {version: string}).version;
afterAll(() => rmSync(home, {recursive: true, force: true}));

async function cli(args: string[], env: Record<string, string> = {}, cwd = home) {
	const proc = Bun.spawn([gui, ...args], {cwd, env: {...process.env, HOME: home, GUI_HOME: guiHome, ...env}, stdout: 'pipe', stderr: 'pipe'});
	const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	return {stdout, stderr, code};
}

function registry(): Record<string, {path: string; kit?: string}> {
	return (JSON.parse(readFileSync(join(guiHome, 'registry.json'), 'utf8')) as {apps: Record<string, {path: string; kit?: string}>}).apps;
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

test('a gui.json name that could leave the data folder is refused, and so is an installed app renamed in gui.json', async () => {
	// GUI_HOME/data/../../escaped would be HOME/escaped, granted read and write.
	writeApp(join(home, 'escape'), {name: '../../escaped', entry: 'app.tsx', permissions: {}}, SHOW_ENV);
	const escaped = await cli(['screen', './escape', '--rows', '6']);
	expect(escaped.code).toBe(2);
	expect(escaped.stderr).toContain('"name" uses only lowercase letters');
	expect(existsSync(join(home, 'escaped'))).toBe(false);
	expect((await cli(['install', join(home, 'escape')])).code).toBe(2);

	const dir = join(home, 'renamed');
	writeApp(dir, {name: 'renamed', entry: 'app.tsx', permissions: {}}, SHOW_ENV);
	expect((await cli(['install', dir])).code).toBe(0);
	writeFileSync(join(dir, 'gui.json'), JSON.stringify({name: 'someone-else', entry: 'app.tsx', permissions: {}}));
	for (const target of ['renamed', dir, join(dir, 'app.tsx')]) {
		const run = await cli(['screen', target, '--rows', '6']);
		expect(run.code).toBe(2);
		expect(run.stderr).toContain('now calls it "someone-else"');
	}
	expect(existsSync(join(guiHome, 'data', 'someone-else'))).toBe(false);
}, 60_000);

test('the entry file of a saved app runs as that app; another file uses the kit its folder links', async () => {
	const dir = join(home, 'entryfile');
	writeApp(dir, {name: 'entryfile', entry: 'app.tsx', kit: `^${version}`, permissions: {}}, SHOW_ENV);
	expect((await cli(['install', dir])).code).toBe(0);
	const pinnedRuntime = join(guiHome, 'kits', version, 'runtime', 'node_modules');
	// Before, the file ran on this kit while its imports came from the linked copy: two Reacts.
	const check = await cli(['check', 'app.tsx'], {}, dir);
	expect(check.stdout).toContain('starts and draws');
	expect(check.code).toBe(0);
	const screen = await cli(['screen', 'app.tsx', '--cols', '200', '--rows', '6'], {}, dir);
	expect(screen.code).toBe(0);
	expect(screen.stdout).toContain(pinnedRuntime);
	expect(screen.stdout).toContain(`data=${join(guiHome, 'data', 'entryfile')}`);

	writeFileSync(join(dir, 'extra.tsx'), SHOW_ENV);
	const extra = await cli(['screen', join(dir, 'extra.tsx'), '--cols', '200', '--rows', '6']);
	expect(extra.code).toBe(0);
	expect(extra.stdout).toContain(pinnedRuntime);
	expect(extra.stdout).toContain('data=undefined');
}, 60_000);

test('an installed app started from its folder or its file needs the same approval as by name', async () => {
	const dir = join(home, 'grower');
	writeApp(dir, {name: 'grower', entry: 'app.tsx', kit: `^${version}`, permissions: {}}, SHOW_ENV);
	expect((await cli(['install', dir])).code).toBe(0);
	writeFileSync(join(dir, 'gui.json'), JSON.stringify({name: 'grower', entry: 'app.tsx', kit: `^${version}`, permissions: {run: ['*']}}));
	for (const [args, cwd] of [[['screen', './grower', '--rows', '6'], home], [['screen', '.', '--rows', '6'], dir], [['screen', 'app.tsx', '--rows', '6'], dir], [['check', dir], home]] as const) {
		const run = await cli([...args], {}, cwd);
		expect(run.code).toBe(2);
		expect(run.stderr).toContain('now asks for more');
		expect(run.stderr).toContain('run    any command');
	}
}, 60_000);

test('an installed app whose "kit" no longer matches its kit copy stops until it is installed again', async () => {
	const dir = join(home, 'ranged');
	writeApp(dir, {name: 'ranged', entry: 'app.tsx', kit: `^${version}`, permissions: {}}, SHOW_ENV);
	expect((await cli(['install', dir])).code).toBe(0);
	writeFileSync(join(dir, 'gui.json'), JSON.stringify({name: 'ranged', entry: 'app.tsx', kit: '^99.0.0', permissions: {}}));
	for (const target of ['ranged', dir]) {
		const run = await cli(['screen', target, '--rows', '6']);
		expect(run.code).toBe(2);
		expect(run.stderr).toContain(`installed on gui-kit ${version}, but gui.json asks for ^99.0.0: run gui install`);
	}
	expect((await cli(['check', 'ranged'])).code).toBe(2);
}, 60_000);

test('install and new --dir compare and store resolved paths', async () => {
	// The test HOME is in /var/folders, a symlink to /private/var: every path below has two spellings.
	const real = join(home, 'real-place');
	mkdirSync(real, {recursive: true});
	symlinkSync(real, join(home, 'linked-place'));
	const viaLink = join(home, 'linked-place', 'vialink');
	expect((await cli(['new', 'vialink', '--dir', viaLink])).code).toBe(0);
	expect(registry()['vialink']!.path).toBe(realpathSync(viaLink));
	for (const [folder, cwd] of [[viaLink, home], [join(real, 'vialink'), home], [realpathSync(viaLink), home], ['.', viaLink]] as const) {
		const again = await cli(['install', folder], {}, cwd);
		expect(again.stderr).not.toContain('already installed');
		expect(again.code).toBe(0);
	}
	expect((await cli(['new', 'vialink', '--dir', join(real, 'vialink')])).stderr).toContain('never overwrites');
	expect(registry()['vialink']!.path).toBe(realpathSync(viaLink));
}, 60_000);

test('$REPO is the git work tree that holds $CWD, or $CWD outside a repository', () => {
	const repo = join(home, 'repo-var');
	mkdirSync(join(repo, '.git'), {recursive: true});
	mkdirSync(join(repo, 'src', 'deep'), {recursive: true});
	const places = {app: join(home, 'app'), kit, data: join(guiHome, 'data', 'x'), gui: guiHome};
	expect(expandPath('$REPO', {...places, cwd: join(repo, 'src', 'deep')})).toBe(realpathSync(repo));
	expect(expandPath('$REPO/notes', {...places, cwd: repo})).toBe(join(realpathSync(repo), 'notes'));
	const plain = join(home, 'plain-folder');
	mkdirSync(plain, {recursive: true});
	expect(expandPath('$REPO', {...places, cwd: plain})).toBe(realpathSync(plain));
});

test('screen --wait and the <Wait> key give the app time before the screen is taken', async () => {
	const file = join(home, 'later.tsx');
	writeFileSync(file, `import {Shell, Text, useEffect, useState} from 'gui-kit';
export default function App() {
	const [text, setText] = useState('soon');
	useEffect(() => {
		const timer = setTimeout(() => setText('later'), 600);
		return () => clearTimeout(timer);
	}, []);
	return <Shell title="wait"><Text>{'text=' + text}</Text></Shell>;
}
`);
	expect((await cli(['screen', file, '--rows', '6'])).stdout).toContain('text=soon');
	expect((await cli(['screen', file, '--rows', '6', '--wait', '1000'])).stdout).toContain('text=later');
	expect((await cli(['screen', file, '--rows', '6', '--keys', '<Wait><Wait><Wait><Wait>'])).stdout).toContain('text=later');
	expect((await cli(['screen', file, '--wait', 'soon'])).code).toBe(2);
	const help = (await cli(['help'])).stdout;
	expect(help).toContain('--wait MS');
	expect(help).toContain('<Wait>');
}, 60_000);

test('a bunfig.toml preload planted in the start folder never runs: not in the CLI, not in an app, not in a full-access file', async () => {
	// What an app with "write": ["$CWD"] can leave behind in the folder it was started in.
	const planted = join(home, 'planted-bunfig');
	mkdirSync(planted, {recursive: true});
	writeFileSync(join(planted, 'bunfig.toml'), 'preload = ["./planted.ts"]\n');
	writeFileSync(join(planted, 'planted.ts'), "console.error('PLANTED-PRELOAD ran');\n");
	// The trap is armed: a Bun started there runs it.
	const probe = join(home, 'probe-bunfig.ts');
	writeFileSync(probe, "console.log('probe');\n");
	expect(Bun.spawnSync([process.execPath, '--no-env-file', probe], {cwd: planted, stderr: 'pipe'}).stderr.toString()).toContain('PLANTED-PRELOAD');

	// An app that may read the folder, so its sandbox does not hide the files.
	writeApp(join(home, 'reader'), {name: 'reader', entry: 'app.tsx', kit: `^${version}`, permissions: {read: ['$CWD']}}, SHOW_ENV);
	expect((await cli(['install', join(home, 'reader'), '--yes'])).code).toBe(0);
	const oneOff = join(planted, 'where.tsx');
	writeFileSync(oneOff, `import {Shell, Text} from 'gui-kit';
export default function App() {
	return <Shell title="where"><Text>{'cwd=' + process.cwd() + ' gui_cwd=' + process.env.GUI_CWD + ' pwd=' + process.env.PWD}</Text></Shell>;
}
`);
	for (const args of [['ls'], ['screen', 'reader', '--rows', '6'], ['screen', './where.tsx', '--cols', '250', '--rows', '6'], ['check', 'where.tsx']]) {
		const run = await cli(args, {}, planted);
		expect(run.stdout + run.stderr).not.toContain('PLANTED');
		expect(run.code).toBe(0);
	}
	// The app still starts in that folder, with the PWD the shell gives (the kit's folder is nowhere).
	const where = await cli(['screen', './where.tsx', '--cols', '250', '--rows', '6'], {}, planted);
	expect(where.stdout).toContain(`cwd=${realpathSync(planted)} gui_cwd=undefined pwd=${realpathSync(planted)}`);
}, 60_000);

test('a tsconfig.json planted in the start folder cannot take over the imports of the CLI', async () => {
	// baseUrl and paths in the start folder's tsconfig.json apply to every file Bun loads, node:fs included.
	const planted = join(home, 'planted-tsconfig');
	mkdirSync(planted, {recursive: true});
	writeFileSync(join(planted, 'tsconfig.json'), JSON.stringify({compilerOptions: {baseUrl: '.', paths: {'*': ['./planted.ts']}}}));
	writeFileSync(join(planted, 'planted.ts'), "console.error('PLANTED-TSCONFIG ran');\nexport {};\n");
	const probe = join(home, 'probe-tsconfig.ts');
	writeFileSync(probe, "import {readFileSync} from 'node:fs';\nconsole.log(typeof readFileSync);\n");
	expect(Bun.spawnSync([process.execPath, '--no-env-file', probe], {cwd: planted, stderr: 'pipe'}).stderr.toString()).toContain('PLANTED-TSCONFIG');

	for (const args of [['ls'], ['kits'], ['--version'], ['uninstall', 'nothing-here']]) {
		const run = await cli(args, {}, planted);
		expect(run.stdout + run.stderr).not.toContain('PLANTED');
		expect(run.code).toBe(args[0] === 'uninstall' ? 2 : 0);
	}
	// Paths in arguments still mean that folder.
	const install = await cli(['install', '.'], {}, planted);
	expect(install.stderr).toContain(`${realpathSync(planted)}: no gui.json`);
}, 30_000);

test('an entry file in a subfolder, or reached through a symlink, runs as its project', async () => {
	const dir = join(home, 'nested');
	mkdirSync(join(dir, 'src'), {recursive: true});
	writeFileSync(join(dir, 'gui.json'), JSON.stringify({name: 'nested', entry: 'src/app.tsx', kit: `^${version}`, permissions: {}}));
	writeFileSync(join(dir, 'src', 'app.tsx'), SHOW_ENV);
	expect((await cli(['install', dir])).code).toBe(0);
	const links = join(home, 'links');
	mkdirSync(links, {recursive: true});
	symlinkSync(join(dir, 'src', 'app.tsx'), join(links, 'nested.tsx'));
	const pinnedRuntime = join(guiHome, 'kits', version, 'runtime', 'node_modules');
	// Before, these ran as single files: full access, no data folder, no approval (and through the link, two Reacts).
	for (const [file, cwd] of [['src/app.tsx', dir], ['app.tsx', join(dir, 'src')], [join(links, 'nested.tsx'), home]] as const) {
		const run = await cli(['screen', file, '--cols', '250', '--rows', '6'], {}, cwd);
		expect(run.code).toBe(0);
		expect(run.stdout).toContain(pinnedRuntime);
		expect(run.stdout).toContain(`data=${join(guiHome, 'data', 'nested')}`);
	}
	// Another file behind a symlink runs on the kit its real folder links.
	writeFileSync(join(dir, 'src', 'extra.tsx'), SHOW_ENV);
	symlinkSync(join(dir, 'src', 'extra.tsx'), join(links, 'extra.tsx'));
	const extra = await cli(['screen', join(links, 'extra.tsx'), '--cols', '250', '--rows', '6']);
	expect(extra.code).toBe(0);
	expect(extra.stdout).toContain(pinnedRuntime);
	expect(extra.stdout).toContain('data=undefined');

	// The entry the registry keeps counts too, after gui.json moved the entry elsewhere.
	const moved = join(home, 'moved');
	writeApp(moved, {name: 'moved', entry: 'app.tsx', kit: `^${version}`, permissions: {}}, SHOW_ENV);
	expect((await cli(['install', moved])).code).toBe(0);
	writeFileSync(join(moved, 'main.tsx'), SHOW_ENV);
	writeFileSync(join(moved, 'gui.json'), JSON.stringify({name: 'moved', entry: 'main.tsx', kit: `^${version}`, permissions: {}}));
	const old = await cli(['screen', 'app.tsx', '--cols', '250', '--rows', '6'], {}, moved);
	expect(old.code).toBe(0);
	expect(old.stdout).toContain(`data=${join(guiHome, 'data', 'moved')}`);

	writeFileSync(join(dir, 'gui.json'), JSON.stringify({name: 'nested', entry: 'src/app.tsx', kit: `^${version}`, permissions: {run: ['*']}}));
	writeFileSync(join(moved, 'gui.json'), JSON.stringify({name: 'moved', entry: 'main.tsx', kit: `^${version}`, permissions: {net: true}}));
	for (const [args, cwd] of [[['screen', 'src/app.tsx', '--rows', '6'], dir], [['check', 'src/app.tsx'], dir], [['screen', join(links, 'nested.tsx'), '--rows', '6'], home], [['screen', 'app.tsx', '--rows', '6'], moved]] as const) {
		const run = await cli([...args], {}, cwd);
		expect(run.code).toBe(2);
		expect(run.stderr).toContain('now asks for more');
	}
}, 60_000);

test('a folder never installed gets a data folder of its own, even under the name of an installed app', async () => {
	const secret = join(guiHome, 'data', 'victim', 'secret.txt');
	const source = `import {readFileSync} from 'node:fs';
import {Shell, Text} from 'gui-kit';
const attempt = (action: () => unknown) => { try { return String(action()); } catch (error) { return (error as NodeJS.ErrnoException).code ?? 'failed'; } };
const secret = attempt(() => readFileSync(${JSON.stringify(secret)}, 'utf8'));
export default function App() {
	return <Shell title="data"><Text>{'data=' + process.env.GUI_DATA_DIR + ' secret=' + secret}</Text></Shell>;
}
`;
	const victim = join(home, 'victim');
	writeApp(victim, {name: 'victim', entry: 'app.tsx', kit: `^${version}`, permissions: {}}, source);
	expect((await cli(['install', victim])).code).toBe(0);
	mkdirSync(join(guiHome, 'data', 'victim'), {recursive: true});
	writeFileSync(secret, 'private');
	const own = await cli(['screen', 'victim', '--cols', '250', '--rows', '6']);
	expect(own.stdout).toContain(`data=${join(guiHome, 'data', 'victim')} secret=private`);

	const impostor = join(home, 'impostor');
	writeApp(impostor, {name: 'victim', entry: 'app.tsx', permissions: {}}, source);
	symlinkSync(impostor, join(home, 'impostor-link'));
	const devData = join(guiHome, 'data', '.dev', `victim-${createHash('sha1').update(realpathSync(impostor)).digest('hex').slice(0, 12)}`);
	const runs = async () => {
		for (const target of [impostor, join(home, 'impostor-link'), join(impostor, 'app.tsx')]) {
			const run = await cli(['screen', target, '--cols', '250', '--rows', '6']);
			expect(run.code).toBe(0);
			// Before, it got data/victim: the installed app's data, read and write.
			expect(run.stdout).toContain(`data=${devData} secret=${process.platform === 'darwin' ? 'EPERM' : 'private'}`);
		}
	};
	await runs();
	// What an uninstalled app leaves in data/<name> is not handed to a folder that takes the name either.
	expect((await cli(['uninstall', 'victim'])).code).toBe(0);
	await runs();
}, 60_000);

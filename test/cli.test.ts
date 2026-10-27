import {afterAll, expect, test} from 'bun:test';
import {existsSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// The CLI runs with a throwaway HOME so it never touches the real registry.
const home = mkdtempSync(join(tmpdir(), 'gui-cli-test-'));
const gui = join(import.meta.dir, '..', 'bin', 'gui');
afterAll(() => rmSync(home, {recursive: true, force: true}));

async function cli(...args: string[]) {
	const proc = Bun.spawn([gui, ...args], {cwd: home, env: {...process.env, HOME: home, GUI_HOME: join(home, 'gui')}, stdout: 'pipe', stderr: 'pipe'});
	const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
	return {stdout, stderr, code};
}

test('new, ls, screen and uninstall an app', async () => {
	expect((await cli('new', 'prova', '--description', 'App di prova')).code).toBe(0);
	expect((await cli('ls')).stdout).toContain('App di prova');
	const screen = await cli('screen', 'prova', '--cols', '60', '--rows', '8', '--keys', 'j<CR>');
	expect(screen.stdout).toContain('Secondo');
	expect(screen.stdout).toContain('[finish] "Secondo"');
	expect((await cli('uninstall', 'prova')).code).toBe(0);
	expect((await cli('ls')).stdout).toContain('Nessuna app installata');
	expect(existsSync(join(home, 'prova', 'app.tsx'))).toBe(true);
}, 30_000);

test('install --bin writes a launcher that uninstall removes', async () => {
	await cli('new', 'lanciabile');
	expect((await cli('install', 'lanciabile', '--bin')).code).toBe(0);
	const bin = join(home, '.local', 'bin', 'lanciabile');
	expect(existsSync(bin)).toBe(true);
	await cli('uninstall', 'lanciabile');
	expect(existsSync(bin)).toBe(false);
}, 30_000);

test('screen runs a one-off file from any folder', async () => {
	const file = join(home, 'domanda.tsx');
	writeFileSync(file, `import {Confirm, Shell, useFinish} from 'gui-kit';
export default function App() {
	const finish = useFinish();
	return <Shell title="Domanda"><Confirm question="Va bene?" onAnswer={finish} /></Shell>;
}
`);
	const screen = await cli('screen', file, '--cols', '50', '--rows', '6', '--keys', 'y');
	expect(screen.stdout).toContain('Va bene?');
	expect(screen.stdout).toContain('[finish] true');
	expect((await cli('check', file)).code).toBe(0);
}, 30_000);

test('unknown app fails with a hint', async () => {
	const result = await cli('nessuna-app');
	expect(result.code).toBe(2);
	expect(result.stderr).toContain('gui ls');
});

test('names of subcommands are refused, and check catches a missing default export', async () => {
	const reserved = await cli('new', 'run');
	expect(reserved.code).toBe(2);
	expect(reserved.stderr).toContain('comando di gui');
	const file = join(home, 'senza-default.tsx');
	writeFileSync(file, `import {Shell, Text} from 'gui-kit';
export function App() {
	return <Shell title="x"><Text>ciao</Text></Shell>;
}
`);
	const check = await cli('check', file);
	expect(check.stdout).toContain('tipi ok');
	expect(check.code).toBe(2);
	expect(check.stderr).toContain('esportare di default');
}, 30_000);

test('screen passes arguments and reports an app that quit', async () => {
	const file = join(home, 'argomenti.tsx');
	writeFileSync(file, `import {Shell, Text} from 'gui-kit';
export default function App() {
	const args = JSON.parse(process.env.GUI_ARGS ?? '[]') as string[];
	return <Shell title="args"><Text>{'argomenti: ' + args.join(',')}</Text></Shell>;
}
`);
	const screen = await cli('screen', file, 'uno', 'due', '--keys', 'q', '--cols', '60', '--rows', '6');
	expect(screen.stdout).toContain('argomenti: uno,due');
	expect(screen.stdout).toContain('[uscita]');
}, 30_000);

test('new never overwrites, install never moves a name, launchers survive a reinstall', async () => {
	const keep = join(home, 'keep');
	await cli('new', 'tmp-keep', '--dir', keep);
	writeFileSync(join(home, 'existing.tsx'), 'IMPORTANT');
	const clash = await cli('new', 'altra', '--dir', keep);
	expect(clash.code).toBe(2);
	expect(clash.stderr).toContain('non sovrascrive');

	const missingFrom = await cli('new', 'da-niente', '--dir', join(home, 'niente'), '--from', join(home, 'non-esiste.tsx'));
	expect(missingFrom.code).toBe(2);
	expect(existsSync(join(home, 'niente', 'gui.json'))).toBe(false);

	const moved = await cli('new', 'tmp-keep', '--dir', join(home, 'altrove'));
	expect(moved.code).toBe(2);
	expect(moved.stderr).toContain('già installata');

	expect((await cli('install', keep, '--bin')).code).toBe(0);
	expect((await cli('install', keep)).code).toBe(0);
	const bin = join(home, '.local', 'bin', 'tmp-keep');
	expect(existsSync(bin)).toBe(true);
	await cli('uninstall', 'tmp-keep');
	expect(existsSync(bin)).toBe(false);
}, 60_000);

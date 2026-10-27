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

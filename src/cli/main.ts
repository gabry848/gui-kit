// `gui`: run, ask, check and manage terminal apps built with gui-kit.

import {chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {loadRegistry, readManifest, resolveTarget, saveRegistry, type Manifest} from './registry.js';

const KIT = resolve(import.meta.dir, '..', '..');
const RUNTIME = join(KIT, 'runtime', 'node_modules');
const BIN_DIR = join(homedir(), '.local', 'bin');

const HELP = `gui — app da terminale fatte con gui-kit

  gui <app> [argomenti]          avvia un'app installata (come gui run)
  gui run <app|cartella|file>    avvia a schermo intero nel terminale corrente
  gui ask <app|file>             avvia e scrive su stdout, in JSON, il valore passato a finish();
                                 esce con 1 se l'utente chiude senza rispondere
  gui screen <app|file> [--keys K] [--cols N] [--rows N]
                                 la disegna in un terminale virtuale, preme i tasti K
                                 (notazione Vim: 5j/cerca<CR>) e stampa lo schermo
  gui check <app|cartella|file>  controllo dei tipi (tsc)
  gui new <nome> [--dir D] [--from file.tsx] [--description T]
                                 crea un progetto (gui.json + app.tsx) e lo installa
  gui install [cartella] [--bin] registra l'app col suo nome; --bin crea anche ~/.local/bin/<nome>
  gui uninstall <nome>           la toglie dal registro (i file restano)
  gui ls [--json]                elenca le app installate
`;

function fail(message: string): never {
	console.error(message);
	process.exit(2);
}

function option(args: string[], name: string): string | undefined {
	const index = args.indexOf(name);
	if (index === -1) return undefined;
	const value = args[index + 1];
	args.splice(index, 2);
	return value;
}

function flag(args: string[], name: string): boolean {
	const index = args.indexOf(name);
	if (index !== -1) args.splice(index, 1);
	return index !== -1;
}

/** NODE_PATH that lets an app anywhere import 'gui-kit', React and Ink from the kit. */
function ensureRuntime(): Record<string, string> {
	const link = join(RUNTIME, 'gui-kit');
	if (!existsSync(link)) {
		mkdirSync(RUNTIME, {recursive: true});
		symlinkSync(relative(RUNTIME, KIT), link);
	}
	return {...process.env, NODE_PATH: [RUNTIME, join(KIT, 'node_modules')].join(':')} as Record<string, string>;
}

async function child(script: string, args: string[], extraEnv: Record<string, string> = {}): Promise<number> {
	const proc = Bun.spawn([process.execPath, join(KIT, 'src', 'cli', script), ...args], {
		env: {...ensureRuntime(), ...extraEnv},
		stdio: ['inherit', 'inherit', 'inherit'],
	});
	return proc.exited;
}

async function runApp(mode: 'run' | 'ask', target: string, appArgs: string[]): Promise<never> {
	const resolved = resolveTarget(target);
	const code = await child('launch.tsx', [mode, resolved.file], {
		GUI_ARGS: JSON.stringify(appArgs),
		GUI_APP_DIR: resolved.dir,
	});
	process.exit(code);
}

function install(dir: string, withBin: boolean): string {
	const manifest = readManifest(dir);
	if (!manifest) fail(`${dir}: manca gui.json`);
	if (!existsSync(join(dir, manifest.entry))) fail(`${dir}: manca ${manifest.entry}`);
	const apps = loadRegistry();
	let bin: string | undefined;
	if (withBin) {
		bin = join(BIN_DIR, manifest.name);
		if (existsSync(bin) && !apps[manifest.name]?.bin) fail(`${bin} esiste già e non l'ha creato gui: scegli un altro nome`);
		mkdirSync(BIN_DIR, {recursive: true});
		writeFileSync(bin, `#!/bin/sh\n# Created by gui install; gui uninstall removes it.\nexec "${join(KIT, 'bin', 'gui')}" run ${JSON.stringify(manifest.name)} "$@"\n`);
		chmodSync(bin, 0o755);
	}
	apps[manifest.name] = {
		path: dir,
		entry: manifest.entry,
		...(manifest.description ? {description: manifest.description} : {}),
		...(bin ? {bin} : {}),
		installed: new Date().toISOString(),
	};
	saveRegistry(apps);
	return manifest.name;
}

const TEMPLATE = `import {List, Shell, Text, useFinish, useState} from 'gui-kit';

const ITEMS = ['Primo', 'Secondo', 'Terzo'];

export default function App() {
	const finish = useFinish();
	const [items] = useState(ITEMS);
	return (
		<Shell title="__NAME__">
			<List
				items={items}
				text={item => item}
				onOpen={item => finish(item)}
				render={item => <Text>{item}</Text>}
			/>
		</Shell>
	);
}
`;

function tsconfig(): string {
	return JSON.stringify({
		compilerOptions: {
			target: 'ES2022',
			module: 'ESNext',
			moduleResolution: 'bundler',
			jsx: 'react-jsx',
			strict: true,
			noEmit: true,
			skipLibCheck: true,
			types: ['bun'],
			typeRoots: [join(KIT, 'node_modules', '@types')],
			paths: {
				'gui-kit': [join(KIT, 'src', 'kit', 'index.ts')],
				'react': [join(KIT, 'node_modules', '@types', 'react')],
				'react/*': [join(KIT, 'node_modules', '@types', 'react', '*')],
				'ink': [join(KIT, 'node_modules', 'ink')],
			},
		},
	}, null, '\t') + '\n';
}

function newApp(args: string[]) {
	const dirOption = option(args, '--dir');
	const from = option(args, '--from');
	const description = option(args, '--description');
	const name = args[0];
	if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) fail('gui new <nome>: il nome usa minuscole, cifre e trattini');
	const dir = resolve(dirOption ?? name);
	if (existsSync(dir) && existsSync(join(dir, 'gui.json'))) fail(`${dir} contiene già un gui.json`);
	mkdirSync(dir, {recursive: true});
	const manifest: Manifest = {name, entry: 'app.tsx', ...(description ? {description} : {})};
	writeFileSync(join(dir, 'gui.json'), JSON.stringify(manifest, null, '\t') + '\n');
	if (from) cpSync(resolve(from), join(dir, 'app.tsx'));
	else writeFileSync(join(dir, 'app.tsx'), TEMPLATE.replace('__NAME__', name));
	writeFileSync(join(dir, 'tsconfig.json'), tsconfig());
	install(dir, false);
	console.log(`Creata e installata: ${name} in ${dir}\nAvvia con: gui ${name}`);
}

async function check(target: string): Promise<never> {
	const resolved = resolveTarget(target);
	const configDir = join(tmpdir(), 'gui-check');
	mkdirSync(configDir, {recursive: true});
	const config = JSON.parse(tsconfig()) as {compilerOptions: object};
	const file = join(configDir, `${basename(resolved.file)}.tsconfig.json`);
	writeFileSync(file, JSON.stringify({...config, files: [resolved.file]}));
	const proc = Bun.spawn([join(KIT, 'node_modules', '.bin', 'tsc'), '-p', file], {stdio: ['inherit', 'inherit', 'inherit']});
	const code = await proc.exited;
	if (code === 0) console.log(`${relative(process.cwd(), resolved.file) || resolved.file}: tipi ok`);
	process.exit(code);
}

const [command = 'help', ...rest] = process.argv.slice(2);
try {
	switch (command) {
		case 'help':
		case '--help':
		case '-h':
			console.log(HELP);
			break;
		case 'run':
		case 'ask': {
			const [target, ...appArgs] = rest;
			if (!target) fail(`gui ${command} <app|file>`);
			await runApp(command, target, appArgs);
			break;
		}
		case 'screen': {
			const keys = option(rest, '--keys') ?? '';
			const cols = option(rest, '--cols') ?? '100';
			const rows = option(rest, '--rows') ?? '30';
			if (!rest[0]) fail('gui screen <app|file> [--keys K]');
			process.exit(await child('screen.tsx', [resolveTarget(rest[0]).file, keys, cols, rows]));
			break;
		}
		case 'check':
			if (!rest[0]) fail('gui check <app|cartella|file>');
			await check(rest[0]);
			break;
		case 'new':
			newApp(rest);
			break;
		case 'install':
		case 'link': {
			const withBin = flag(rest, '--bin');
			const name = install(resolve(rest[0] ?? '.'), withBin);
			console.log(`Installata: ${name}${withBin ? ` (anche come comando ${name})` : ''}`);
			break;
		}
		case 'uninstall':
		case 'unlink': {
			const apps = loadRegistry();
			const app = rest[0] ? apps[rest[0]] : undefined;
			if (!app) fail(`${rest[0] ?? ''}: non è installata`);
			if (app.bin && existsSync(app.bin) && lstatSync(app.bin).isFile() && readFileSync(app.bin, 'utf8').includes('Created by gui install')) {
				rmSync(app.bin);
			}
			delete apps[rest[0]!];
			saveRegistry(apps);
			console.log(`Disinstallata: ${rest[0]} (i file in ${app.path} restano)`);
			break;
		}
		case 'ls':
		case 'list': {
			const apps = loadRegistry();
			if (flag(rest, '--json')) {
				console.log(JSON.stringify(apps, null, 2));
				break;
			}
			const names = Object.keys(apps).sort();
			if (names.length === 0) console.log('Nessuna app installata. Crea la prima con: gui new <nome>');
			for (const name of names) {
				const app = apps[name]!;
				console.log(`${name.padEnd(20)} ${(app.description ?? '').padEnd(40)} ${app.path.replace(homedir(), '~')}`);
			}
			break;
		}
		default:
			// `gui <app>` is short for `gui run <app>`.
			await runApp('run', command, rest);
	}
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}

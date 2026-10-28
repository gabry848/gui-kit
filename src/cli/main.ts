// `gui`: run, ask, check and manage terminal apps built with gui-kit.

// First: it moves to the folder gui was started in (see bin/gui).
import './cwd.js';
import {chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {homedir, tmpdir} from 'node:os';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {KIT, KIT_VERSION, kitEnv, linkedKit, linkKit, nearestLinkedKit, pickKit, pinnedKit, saveKit, savedKits, type Kit} from './kits.js';
import {covers, describe, ENFORCED, real, sandboxed, type Grant, type Places} from './permissions.js';
import {GUI_HOME, loadRegistry, NAME, readManifest, resolveTarget, saveRegistry, type Target} from './registry.js';
import {inScratch, listScratch, newScratch, SCRATCH, touchScratch} from './scratch.js';

// Subcommands; an app named like one could not be started as `gui <name>`.
const COMMANDS = ['help', 'run', 'ask', 'screen', 'check', 'new', 'install', 'link', 'uninstall', 'unlink', 'ls', 'list', 'scratch', 'keep', 'gc', 'kits'];
const BIN_DIR = join(homedir(), '.local', 'bin');

function tildify(path: string): string {
	return path.startsWith(homedir() + '/') ? '~' + path.slice(homedir().length) : path;
}

const HELP = `gui — terminal apps built with gui-kit ${KIT_VERSION}

  gui <app> [args]               start an installed app (same as gui run)
  gui run <app|folder|file>      start it full screen in this terminal
  gui ask <app|folder|file>      start it and print the value passed to finish() as JSON;
                                 exit 1 if the user closes it without answering or it fails,
                                 3 if there is no terminal to draw on
  gui screen <app|folder|file> [--keys K] [--wait MS] [--cols N] [--rows N] [args] [-- args]
                                 draw it in a virtual terminal, press the keys K (Vim
                                 notation: 5j/find<CR>; <Wait> pauses 250 ms), wait MS ms
                                 more if given, print the screen, then [finish] <json>,
                                 or [exit] if the app quit; exit 1 on an error
  gui check <app|folder|file>    type check (tsc) and a first render without a terminal

  gui scratch [name]             new one-off app file in ${tildify(SCRATCH)}; prints its path
  gui keep <file> <name> [--dir D] [--description T] [--bin] [--yes]
                                 turn a one-off file into a saved app and install it
  gui new <name> [--dir D] [--from file.tsx] [--description T]
                                 create a project (gui.json + app.tsx) and install it
  gui install [folder] [--bin] [--yes]
                                 register the app by name, on a copy of this kit; asks you
                                 to approve its permissions (--yes: already approved);
                                 --bin also writes ~/.local/bin/<name>
  gui uninstall <name>           remove it from the registry (its files and data stay)
  gui ls [--json]                installed apps and one-off files
  gui kits                       saved kit versions and the apps on them
  gui gc [--days N] [--dry-run]  delete one-off files unused for N days (default 7) and
                                 kit copies no installed app uses
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

type Prepared = {kit: Kit; grant: Grant; places: Places; env: Record<string, string>};

/** The kit, sandbox and environment an app runs with. */
function prepare(target: Target, appArgs: string[]): Prepared {
	const {installed, manifest} = target;
	let kit: Kit;
	if (installed && manifest) {
		// Started by name or from its folder: either way it gets only what you approved.
		const name = target.name!;
		if (manifest.name !== name) {
			fail(`${name} is installed from ${installed.path}, but its gui.json now calls it "${manifest.name}": put the name back, or run gui uninstall ${name} and then gui install ${installed.path}`);
		}
		if (!covers(installed.permissions, manifest.permissions)) {
			fail(`${name} now asks for more than you allowed:\n${describe(manifest.permissions).map(line => `  ${line}`).join('\n')}\nReview and approve it with: gui install ${installed.path}`);
		}
		if (installed.kit && manifest.kit && !Bun.semver.satisfies(installed.kit, manifest.kit)) {
			fail(`${name} is installed on gui-kit ${installed.kit}, but gui.json asks for ${manifest.kit}: run gui install ${installed.path}`);
		}
		kit = installed.kit ? pinnedKit(installed.kit) : pickKit(manifest.kit);
		linkKit(installed.path, kit);
	} else if (manifest) {
		// A project runs on the kit its node_modules links, so its imports and its sandbox agree.
		const linked = linkedKit(target.dir);
		if (linked && manifest.kit && !Bun.semver.satisfies(linked.version, manifest.kit)) {
			fail(`${target.dir} links gui-kit ${linked.version}, but gui.json asks for ${manifest.kit}: run gui install ${target.dir}`);
		}
		kit = linked ?? pickKit(manifest.kit);
	} else {
		// A single file imports the kit its folder links, if any, so the child scripts must come from that kit too.
		kit = nearestLinkedKit(target.dir) ?? pickKit(undefined);
	}
	touchScratch(target.file);
	// An installed app keeps the data folder of the name you installed it under; a folder never installed gets its own.
	const data = manifest ? (installed ? dataFolder(target.name!) : dataFolder(manifest.name, target.dir)) : undefined;
	if (data) mkdirSync(data, {recursive: true});
	return {
		kit,
		grant: manifest?.permissions ?? 'full',
		places: {app: target.dir, kit: kit.dir, data: data ?? join(GUI_HOME, 'data'), cwd: process.cwd(), gui: GUI_HOME},
		env: {
			...(process.env as Record<string, string>),
			...kitEnv(kit),
			GUI_ARGS: JSON.stringify(appArgs),
			GUI_APP_DIR: target.dir,
			...(data ? {GUI_DATA_DIR: data} : {}),
			...terminalDevice(),
		},
	};
}

/**
 * GUI_HOME/data/<name> for an installed app. A project folder that was never
 * installed (`devDir`) gets GUI_HOME/data/.dev/<name>-<hash of its resolved
 * path>: its gui.json may use any name, and the name alone must not hand it the
 * data of an installed app, or what an uninstalled one left. The sandbox lets
 * the app read and write the folder, so it must stay inside GUI_HOME/data.
 */
function dataFolder(name: string, devDir?: string): string {
	const root = devDir === undefined ? resolve(GUI_HOME, 'data') : resolve(GUI_HOME, 'data', '.dev');
	const dir = resolve(root, devDir === undefined ? name : `${name}-${createHash('sha1').update(real(devDir)).digest('hex').slice(0, 12)}`);
	if (!NAME.test(name) || dirname(dir) !== root) fail(`${name}: not a valid app name, so it gets no data folder`);
	return dir;
}

/**
 * The terminal behind piped stdio, as in `answer=$(gui ask form.tsx)`. Found
 * here because ps is setuid and the sandbox cannot run it.
 */
function terminalDevice(): {GUI_TTY?: string} {
	if (process.stdout.isTTY && process.stdin.isTTY) return {};
	const name = Bun.spawnSync(['ps', '-o', 'tty=', '-p', String(process.pid)]).stdout.toString().trim();
	return {GUI_TTY: !name || name === '??' ? 'none' : `/dev/${name}`};
}

type Stdio = 'inherit' | 'ignore';

/** Runs one of the kit's child scripts for an app, inside its sandbox. */
async function child(prepared: Prepared, script: string, args: string[], stdio: [Stdio, Stdio, Stdio] = ['inherit', 'inherit', 'inherit']): Promise<number> {
	// No app, full access included, loads the bunfig.toml of the folder it starts in: another app allowed to
	// write there could have put one with a preload script. An app with permissions never gets the .env of
	// that folder either: Bun would load it before the app runs.
	const bunOptions = ['--config=/dev/null', ...(prepared.grant === 'full' ? [] : ['--no-env-file'])];
	const argv = sandboxed([process.execPath, ...bunOptions, join(prepared.kit.dir, 'src', 'cli', script), ...args], prepared.grant, prepared.places);
	return Bun.spawn(argv, {env: prepared.env, stdio}).exited;
}

async function runApp(mode: 'run' | 'ask', target: string, appArgs: string[]): Promise<never> {
	const resolved = resolveTarget(target);
	process.exit(await child(prepare(resolved, appArgs), 'launch.tsx', [mode, resolved.file]));
}

const LAUNCHER_MARK = 'Created by gui install';

function isOurLauncher(file: string): boolean {
	return existsSync(file) && lstatSync(file).isFile() && readFileSync(file, 'utf8').includes(LAUNCHER_MARK);
}

function checkName(name: string) {
	if (!NAME.test(name)) fail(`${name}: a name uses only lowercase letters, digits and dashes`);
	if (COMMANDS.includes(name)) fail(`${name}: that is a gui command, pick another name`);
}

/** A name already installed from another folder is not silently moved; symlinked paths to the same folder are the same folder. */
function checkFree(apps: Record<string, {path: string}>, name: string, dir: string) {
	const other = apps[name];
	if (other && real(other.path) !== real(dir)) fail(`${name} is already installed from ${other.path}: run \`gui uninstall ${name}\` first`);
}

/** Shows what an app asks for and gets the user's yes, or --yes when they already agreed. */
function approve(name: string, grant: Grant, yes: boolean) {
	const lines = describe(grant).map(line => `  ${line}`);
	if (!ENFORCED) lines.push('  (shown but not enforced: only macOS runs apps in a sandbox)');
	console.error(`${name} asks for:\n${lines.join('\n')}`);
	if (yes) return;
	if (!process.stdin.isTTY) {
		fail(`${name} needs your approval. Show the list above to the user; once they agree, run the same command with --yes.`);
	}
	const answer = prompt('Allow? [y/N]');
	if (!/^y(es)?$/i.test(answer?.trim() ?? '')) fail(`${name}: not installed`);
}

function install(folder: string, {bin: withBin = false, yes = false} = {}): string {
	// The registry keeps resolved paths, so the same folder reached through a symlink matches.
	const dir = real(resolve(folder));
	const manifest = readManifest(dir);
	if (!manifest) fail(`${dir}: no gui.json`);
	checkName(manifest.name);
	if (!existsSync(join(dir, manifest.entry))) fail(`${dir}: ${manifest.entry} is missing`);
	const apps = loadRegistry();
	checkFree(apps, manifest.name, dir);
	const previous = apps[manifest.name];
	if (!covers(previous?.permissions, manifest.permissions)) approve(manifest.name, manifest.permissions, yes);
	// The app keeps this kit even when the kit changes later.
	const picked = pickKit(manifest.kit);
	const kit = picked.current ? saveKit() : picked;
	linkKit(dir, kit);
	// Reinstalling without --bin keeps a launcher made earlier.
	let bin = previous?.bin && isOurLauncher(previous.bin) ? previous.bin : undefined;
	if (withBin) {
		bin = join(BIN_DIR, manifest.name);
		if (existsSync(bin) && !isOurLauncher(bin)) fail(`${bin} already exists and gui did not create it: pick another name`);
		mkdirSync(BIN_DIR, {recursive: true});
		writeFileSync(bin, `#!/bin/sh\n# ${LAUNCHER_MARK}; gui uninstall removes it.\nexec "${join(KIT, 'bin', 'gui')}" run ${JSON.stringify(manifest.name)} "$@"\n`);
		chmodSync(bin, 0o755);
	}
	apps[manifest.name] = {
		path: dir,
		entry: manifest.entry,
		...(manifest.description ? {description: manifest.description} : {}),
		kit: kit.version,
		permissions: manifest.permissions,
		...(bin ? {bin} : {}),
		installed: new Date().toISOString(),
	};
	saveRegistry(apps);
	return manifest.name;
}

const TEMPLATE = `import {List, Shell, Text, useFinish, useState} from 'gui-kit';

const ITEMS = ['First', 'Second', 'Third'];

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

/** A project's own tsconfig: its node_modules links the kit, so it needs no paths. */
const PROJECT_TSCONFIG = JSON.stringify({
	compilerOptions: {
		target: 'ES2022',
		module: 'ESNext',
		moduleResolution: 'bundler',
		jsx: 'react-jsx',
		strict: true,
		noEmit: true,
		skipLibCheck: true,
		types: ['bun'],
	},
}, null, '\t') + '\n';

/**
 * The config gui check writes for one file. Bun follows tsconfig paths when it
 * runs code too, so these never go in a project's own tsconfig.json.
 */
function checkConfig(kit: Kit): string {
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
			typeRoots: [join(kit.dir, 'node_modules', '@types')],
			paths: {
				'gui-kit': [join(kit.dir, 'src', 'kit', 'index.ts')],
				'react': [join(kit.dir, 'node_modules', '@types', 'react')],
				'react/*': [join(kit.dir, 'node_modules', '@types', 'react', '*')],
				'ink': [join(kit.dir, 'node_modules', 'ink')],
			},
		},
	}, null, '\t') + '\n';
}

type ProjectOptions = {name: string; dir?: string | undefined; from?: string | undefined; description?: string | undefined};

/** Writes gui.json, app.tsx and tsconfig.json; checks everything first, so a refusal leaves nothing behind. */
function createProject({name, dir: dirOption, from, description}: ProjectOptions): string {
	checkName(name);
	// Resolved (symlinks followed) even before the folder exists, as the registry stores it.
	const dir = real(resolve(dirOption ?? name));
	for (const file of ['gui.json', 'app.tsx', 'tsconfig.json']) {
		if (existsSync(join(dir, file))) fail(`${join(dir, file)} already exists: gui never overwrites files`);
	}
	if (from && !existsSync(resolve(from))) fail(`${from}: file not found`);
	checkFree(loadRegistry(), name, dir);
	mkdirSync(dir, {recursive: true});
	const manifest = {name, ...(description ? {description} : {}), entry: 'app.tsx', kit: `^${KIT_VERSION}`, permissions: {}};
	writeFileSync(join(dir, 'gui.json'), JSON.stringify(manifest, null, '\t') + '\n');
	if (from) cpSync(resolve(from), join(dir, 'app.tsx'));
	else writeFileSync(join(dir, 'app.tsx'), TEMPLATE.replace('__NAME__', name));
	writeFileSync(join(dir, 'tsconfig.json'), PROJECT_TSCONFIG);
	if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), 'node_modules/\n');
	return dir;
}

function newApp(args: string[]) {
	const dir = option(args, '--dir');
	const from = option(args, '--from');
	const description = option(args, '--description');
	const name = args[0];
	if (!name) fail('gui new <name>');
	const created = createProject({name, dir, from, description});
	install(created);
	console.log(`Created and installed ${name} in ${created}\nStart it with: gui ${name}`);
}

function keep(args: string[]) {
	const dir = option(args, '--dir');
	const description = option(args, '--description');
	const withBin = flag(args, '--bin');
	const yes = flag(args, '--yes');
	const [file, name] = args;
	if (!file || !name) fail('gui keep <file> <name> [--dir D]');
	const created = createProject({name, dir, from: file, description});
	// A scratch file moves into the project; any other file is copied.
	if (inScratch(file)) rmSync(resolve(file));
	install(created, {bin: withBin, yes});
	console.log(`Kept ${name} in ${created}\nStart it with: gui ${name}\nIt has no permissions yet: add what it needs to gui.json, then run gui install ${created}`);
}

async function check(target: string): Promise<never> {
	const resolved = resolveTarget(target);
	const prepared = prepare(resolved, []);
	const configDir = join(tmpdir(), 'gui-check');
	mkdirSync(configDir, {recursive: true});
	const config = JSON.parse(checkConfig(prepared.kit)) as {compilerOptions: object};
	// One config per app file, so checks running at the same time stay apart.
	const file = join(configDir, `${basename(resolved.file)}-${createHash('sha1').update(resolved.file).digest('hex').slice(0, 12)}.tsconfig.json`);
	writeFileSync(file, JSON.stringify({...config, files: [resolved.file]}));
	const code = await Bun.spawn([join(KIT, 'node_modules', '.bin', 'tsc'), '-p', file], {stdio: ['inherit', 'inherit', 'inherit']}).exited;
	const near = relative(process.cwd(), resolved.file);
	const shown = near && !near.startsWith('..') ? near : resolved.file;
	if (code !== 0) process.exit(code);
	console.log(`${shown}: types ok`);
	// Types say nothing about a missing default export or a crash on first render.
	const smokeCode = await child(prepared, 'screen.tsx', [resolved.file, '', '100', '30'], ['ignore', 'ignore', 'inherit']);
	if (smokeCode === 0) console.log(`${shown}: starts and draws`);
	process.exit(smokeCode);
}

function ago(date: Date): string {
	const hours = (Date.now() - date.getTime()) / 3_600_000;
	return hours < 1 ? 'just now' : hours < 48 ? `${Math.round(hours)} h ago` : `${Math.round(hours / 24)} days ago`;
}

function list(args: string[]) {
	const apps = loadRegistry();
	const scratch = listScratch();
	if (flag(args, '--json')) {
		console.log(JSON.stringify({apps, scratch: scratch.map(item => ({file: item.file, used: item.used.toISOString()}))}, null, 2));
		return;
	}
	const names = Object.keys(apps).sort();
	if (names.length === 0) console.log('No apps installed. Make the first one with: gui new <name>');
	for (const name of names) {
		const app = apps[name]!;
		console.log(`${name.padEnd(20)} ${(app.description ?? '').padEnd(40)} kit ${(app.kit ?? '?').padEnd(8)} ${tildify(app.path)}`);
	}
	if (scratch.length > 0) {
		console.log('\nOne-off files (gui gc deletes those unused for 7 days):');
		for (const item of scratch) console.log(`  ${tildify(item.file).padEnd(58)} ${ago(item.used)}`);
	}
}

function kits() {
	const apps = loadRegistry();
	console.log(`this gui   ${KIT_VERSION.padEnd(10)} ${tildify(KIT)}`);
	for (const kit of savedKits()) {
		const users = Object.keys(apps).filter(name => apps[name]!.kit === kit.version);
		console.log(`saved      ${kit.version.padEnd(10)} ${users.length ? users.join(', ') : '(unused)'}`);
	}
}

function gc(args: string[]) {
	const days = Number(option(args, '--days') ?? '7');
	if (!Number.isFinite(days) || days < 0) fail('gui gc --days <number>');
	const dryRun = flag(args, '--dry-run');
	const cutoff = Date.now() - days * 86_400_000;
	const used = new Set(Object.values(loadRegistry()).map(app => app.kit));
	const doomed = [
		...listScratch().filter(item => item.used.getTime() < cutoff).map(item => item.file),
		...savedKits().filter(kit => !used.has(kit.version)).map(kit => kit.dir),
	];
	for (const path of doomed) {
		console.log(`${dryRun ? 'would delete' : 'deleted'} ${tildify(path)}`);
		if (!dryRun) rmSync(path, {recursive: true, force: true});
	}
	if (doomed.length === 0) console.log('Nothing to delete.');
}

const [command = 'help', ...rest] = process.argv.slice(2);
try {
	switch (command) {
		case 'help':
		case '--help':
		case '-h':
			console.log(HELP);
			break;
		case '--version':
			console.log(KIT_VERSION);
			break;
		case 'run':
		case 'ask': {
			const [target, ...appArgs] = rest;
			if (!target) fail(`gui ${command} <app|file>`);
			await runApp(command, target, appArgs);
			break;
		}
		case 'screen': {
			// Everything after `--` goes to the app untouched.
			const dash = rest.indexOf('--');
			const own = dash === -1 ? rest : rest.slice(0, dash);
			const passed = dash === -1 ? [] : rest.slice(dash + 1);
			const keys = option(own, '--keys') ?? '';
			const cols = option(own, '--cols') ?? '100';
			const rows = option(own, '--rows') ?? '30';
			const wait = option(own, '--wait') ?? '0';
			if (!/^\d+$/.test(wait)) fail('gui screen --wait <milliseconds>');
			const [target, ...before] = own;
			if (!target) fail('gui screen <app|file> [--keys K] [--wait MS] [args]');
			const resolved = resolveTarget(target);
			// A kit older than --wait ignores the fifth argument.
			process.exit(await child(prepare(resolved, [...before, ...passed]), 'screen.tsx', [resolved.file, keys, cols, rows, wait]));
			break;
		}
		case 'check':
			if (!rest[0]) fail('gui check <app|folder|file>');
			await check(rest[0]);
			break;
		case 'scratch':
			console.log(newScratch(rest[0]));
			break;
		case 'keep':
			keep(rest);
			break;
		case 'new':
			newApp(rest);
			break;
		case 'install':
		case 'link': {
			const bin = flag(rest, '--bin');
			const yes = flag(rest, '--yes');
			const name = install(resolve(rest[0] ?? '.'), {bin, yes});
			console.log(`Installed ${name}${bin ? ` (also as the command ${name})` : ''}`);
			break;
		}
		case 'uninstall':
		case 'unlink': {
			const apps = loadRegistry();
			const app = rest[0] ? apps[rest[0]] : undefined;
			if (!app) fail(`${rest[0] ?? ''}: not installed`);
			if (app.bin && isOurLauncher(app.bin)) rmSync(app.bin);
			delete apps[rest[0]!];
			saveRegistry(apps);
			console.log(`Uninstalled ${rest[0]} (its files in ${tildify(app.path)} and its data stay)`);
			break;
		}
		case 'ls':
		case 'list':
			list(rest);
			break;
		case 'kits':
			kits();
			break;
		case 'gc':
			gc(rest);
			break;
		default:
			// `gui <app>` is short for `gui run <app>`.
			await runApp('run', command, rest);
	}
} catch (error) {
	fail(error instanceof Error ? error.message : String(error));
}

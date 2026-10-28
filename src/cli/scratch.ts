// One-off apps: single files in GUI_HOME/scratch. Running one marks it as
// used; `gui gc` removes the ones nobody ran for a while.

import {existsSync, mkdirSync, readdirSync, statSync, utimesSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {GUI_HOME} from './registry.js';

export const SCRATCH = join(GUI_HOME, 'scratch');

const TEMPLATE = `import {Select, Shell, useFinish} from 'gui-kit';

// A one-off app: \`gui ask <this file>\` prints the value passed to finish() as JSON.
export default function App() {
	const finish = useFinish();
	return (
		<Shell title="__NAME__">
			<Select
				options={[{label: 'Yes', value: true}, {label: 'No', value: false}]}
				onSelect={finish}
			/>
		</Shell>
	);
}
`;

/** Creates a new scratch file from a template and returns its path. */
export function newScratch(name = 'app'): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`${name}: use letters, digits, dots, dashes and underscores`);
	mkdirSync(SCRATCH, {recursive: true});
	const base = name.replace(/\.tsx$/, '');
	let file = join(SCRATCH, `${base}.tsx`);
	for (let n = 2; existsSync(file); n++) file = join(SCRATCH, `${base}-${n}.tsx`);
	writeFileSync(file, TEMPLATE.replace('__NAME__', base));
	return file;
}

export function inScratch(file: string): boolean {
	return resolve(file).startsWith(SCRATCH + '/');
}

/** Running a scratch app counts as using it. */
export function touchScratch(file: string) {
	if (inScratch(file) && existsSync(file)) {
		const now = new Date();
		utimesSync(file, now, now);
	}
}

export type ScratchApp = {file: string; used: Date};

export function listScratch(): ScratchApp[] {
	if (!existsSync(SCRATCH)) return [];
	return readdirSync(SCRATCH)
		.filter(name => name.endsWith('.tsx'))
		.map(name => ({file: join(SCRATCH, name), used: statSync(join(SCRATCH, name)).mtime}))
		.sort((a, b) => b.used.getTime() - a.used.getTime());
}

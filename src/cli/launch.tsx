// Child process that runs one app. The parent sets NODE_PATH so the app
// resolves 'gui-kit' and React from the kit wherever its file lives. This file
// imports the kit by that name too, so both share one copy of its modules.
// usage: launch.tsx run|ask <file>

import {pathToFileURL} from 'node:url';
import type {ComponentType} from 'react';
import {run} from 'gui-kit';

const [mode, file] = process.argv.slice(2);
const module = (await import(pathToFileURL(file!).href)) as {default?: ComponentType};
const App = module.default;
if (typeof App !== 'function') {
	console.error(`${file}: l'app deve esportare di default il suo componente (export default function App() {...})`);
	process.exit(2);
}

const result = await run(() => <App />);
if (mode === 'ask') {
	if (!result.finished) process.exit(1);
	process.stdout.write(JSON.stringify(result.value) + '\n');
}
process.exit(0);

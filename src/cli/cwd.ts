// bin/gui starts Bun in the kit's folder, so that Bun loads no bunfig.toml or
// tsconfig.json an app may have put in yours, and passes your folder in GUI_CWD
// (PWD stays the one your shell set). main.ts imports this first: every import
// is loaded by then, and everything after it (paths in arguments, $CWD, the
// apps it starts) works in your folder.

const start = process.env['GUI_CWD'];
delete process.env['GUI_CWD'];
if (start !== undefined) {
	try {
		process.chdir(start);
	} catch (error) {
		console.error(`gui: cannot work in ${start}: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(2);
	}
}

export {};

// Runs a short command to completion and collects its output, for git and
// lsof. Long-running tasks go through the kit's useProcess instead.

import type {Subprocess} from 'bun';

export type Result = {
	/** -1 when the command could not start or was stopped. */
	code: number;
	stdout: string;
	stderr: string;
	/** stdout went past maxBytes and the command was stopped there. */
	truncated: boolean;
};

type Options = {
	cwd?: string;
	env?: Record<string, string>;
	/** Stop reading stdout (and the command) after this many bytes. */
	maxBytes?: number;
	timeoutMs?: number;
};

export async function exec(argv: string[], {cwd, env, maxBytes = 4_000_000, timeoutMs = 10_000}: Options = {}): Promise<Result> {
	let proc: Subprocess<'ignore', 'pipe', 'pipe'>;
	try {
		proc = Bun.spawn(argv, {
			...(cwd ? {cwd} : {}),
			env: {...process.env, ...env},
			stdin: 'ignore',
			stdout: 'pipe',
			stderr: 'pipe',
		});
	} catch (error) {
		return {code: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error), truncated: false};
	}
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, timeoutMs);

	const chunks: Uint8Array[] = [];
	let size = 0;
	let truncated = false;
	for await (const chunk of proc.stdout) {
		chunks.push(chunk);
		size += chunk.byteLength;
		if (size > maxBytes) {
			truncated = true;
			proc.kill();
			break;
		}
	}
	const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
	clearTimeout(timer);
	const stdout = new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
	if (timedOut) return {code: -1, stdout, stderr: stderr || `${argv[0]} took longer than ${timeoutMs / 1000} s`, truncated};
	return {code: truncated ? 0 : code, stdout, stderr, truncated};
}

/** The first line of an error output, for a one-line message. */
export function firstLine(text: string): string {
	return text.split('\n').find(line => line.trim() !== '')?.trim() ?? '';
}

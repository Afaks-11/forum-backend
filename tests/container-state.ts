import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ContainerState {
	databaseUrl: string;
	redisUrl: string;
}

/**
 * Jest runs `globalSetup` in the main process but executes test files in worker
 * processes. Mutating `process.env` in global setup is not a reliable way to
 * reach those workers, so the container endpoints are persisted to a temp file
 * that `setup-env.ts` reads synchronously before any application module loads.
 *
 * This ordering is what guarantees `env.config.ts` — which resolves every
 * variable eagerly at import time — sees the real container URLs rather than
 * the placeholder defaults.
 */
const STATE_FILE = join(tmpdir(), "forum-backend-testcontainers.json");

export function writeContainerState(state: ContainerState): void {
	writeFileSync(STATE_FILE, JSON.stringify(state), "utf8");
}

export function readContainerState(): ContainerState | null {
	if (!existsSync(STATE_FILE)) return null;

	try {
		return JSON.parse(readFileSync(STATE_FILE, "utf8")) as ContainerState;
	} catch {
		return null;
	}
}

export function clearContainerState(): void {
	rmSync(STATE_FILE, { force: true });
}

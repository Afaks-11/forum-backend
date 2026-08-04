import { execFileSync } from "node:child_process";
// These two specifiers carry a `.ts` extension, unlike every other import in the
// suite, and that is deliberate. Jest loads `globalSetup`/`globalTeardown` via
// `requireAndTranspileModule`, which applies the configured `transform` but then
// hands the resulting `require()` calls to Node's own CJS resolver —
// `moduleNameMapper` is never consulted. The conventional `./container-state.js`
// specifier is therefore resolved literally and fails, because only the `.ts`
// file exists on disk. Test files are unaffected: they execute inside the Jest
// runtime, where the mapper does apply, so they keep the `.js` convention.
// `tests/` is excluded from tsconfig.json, so this does not reach `tsc`.
import { writeContainerState } from "./container-state.ts";
import { TestContainerOrchestrator } from "./helpers/containers.ts";

/**
 * Boots the PostgreSQL + Redis cluster exactly once for the whole Jest run.
 *
 * Previously every test file started and stopped its own cluster inside
 * `beforeAll`/`afterAll`. That was the direct cause of the recurring
 * `ECONNREFUSED ::1:<dynamic-port>` noise: clients created against file N's
 * container kept retrying after that container was destroyed, while file N+1
 * booted a fresh one on a different port. Booting once removes the churn
 * entirely and cuts suite runtime from N container boots down to one.
 */
export default async function globalSetup(): Promise<void> {
	const orchestrator = TestContainerOrchestrator.getInstance();
	const cluster = await orchestrator.startCluster();

	writeContainerState(cluster);

	// Schema is pushed once here rather than per test file. `prisma generate` is
	// deliberately NOT run: the client is generated at install/build time and
	// regenerating it mid-run rewrites files that loaded modules already hold.
	execFileSync("npx", ["prisma", "db", "push"], {
		env: { ...process.env, DATABASE_URL: cluster.databaseUrl },
		stdio: "inherit",
		shell: process.platform === "win32",
	});
}

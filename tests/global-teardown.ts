// The `.ts` extensions are deliberate — see the note in global-setup.ts. Jest
// resolves requires inside global hooks with Node's CJS resolver, so
// `moduleNameMapper` does not rewrite the usual `.js` specifiers here.
import { clearContainerState } from "./container-state.ts";
import { TestContainerOrchestrator } from "./helpers/containers.ts";

/**
 * Stops the shared cluster after every test file has finished.
 *
 * By this point each worker has already closed its Redis, BullMQ and Prisma
 * handles in `afterAll`, so no client is left retrying against the endpoints
 * this call destroys.
 */
export default async function globalTeardown(): Promise<void> {
	await TestContainerOrchestrator.getInstance().stopCluster();
	clearContainerState();
}

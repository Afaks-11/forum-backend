import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
	traceId: string;
}

/**
 * Ambient per-request context.
 *
 * Background jobs are enqueued deep inside services that never see the Express
 * response, so without this the trace id would stop at the HTTP boundary and a
 * failed email could not be joined back to the request that queued it.
 * AsyncLocalStorage carries it across await points without threading an extra
 * parameter through every service and repository signature.
 *
 * Reads return `undefined` outside a request — worker and cron code paths — so
 * every consumer must treat the trace id as optional.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(
	context: RequestContext,
	callback: () => T,
): T => storage.run(context, callback);

export const getTraceId = (): string | undefined => storage.getStore()?.traceId;

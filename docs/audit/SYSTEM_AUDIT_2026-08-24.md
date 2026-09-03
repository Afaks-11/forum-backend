# FORUM BACKEND — FRESH FULL SYSTEM AUDIT

**Date:** 2026-08-24
**Baseline:** branch `main`, HEAD `3512d18` (clean working tree — the 18 files that were dirty during the 2026-08-22 audit have since been committed as `8e8ef88` and `3512d18`).
**Mode:** Read-only audit. No source, schema, configuration, or dependency file was modified. No test, build, lint, or typecheck was executed.
**Method:** Every load-bearing claim below was re-verified by reading the current source. Prior analysis (`docs/audit/FULL_SYSTEM_AUDIT.md`, `docs/audit/REMAINING_CAPABILITIES_ANALYSIS.md`) was used as a checklist of hypotheses, each confirmed or corrected against the tree before inclusion.

---

# PART 1 — HOW THE SYSTEM WORKS (plain language)

This is a Reddit-style forum backend. One Node.js process contains everything: the HTTP API, the real-time layer, and four background-job processors.

**The life of a request:**

```
Browser sends request
  → Express middlewares run in order:
      cors (which websites may call us) → helmet (security headers)
      → json parser (max 100 KB body) → cookie parser
      → trace id (every request gets an ID for logs)
      → logging → metrics counting
      → rate limiter (Redis counts requests per IP; too many = 429)
  → Router picks the endpoint (e.g. POST /api/v1/posts)
  → Controller: checks the request shape with Zod (validation), then calls exactly one service function
  → Service: the business rules (who may do this, what else must happen,
    what caches to clear, what emails/notifications to queue)
  → Repository: the only place that talks to the database (Prisma → PostgreSQL)
  → Response goes back as JSON
```

Around that core:

- **Redis** is used for speed and coordination, never as the main database: it caches expensive reads (feeds, post details, profiles), counts rate-limit hits, stores logged-out refresh tokens, and holds the queues for background work.
- **BullMQ workers** (running inside the same process) send emails, save notifications to PostgreSQL then push them over Socket.IO, run nightly cleanup jobs, and would re-compute feed rankings (currently dormant — see AUDIT-001).
- **Socket.IO** keeps live connections per user (`user:<id>`) and per post (`post:<id>`) so notifications and new comments arrive instantly.
- **PostgreSQL** is the single source of truth, accessed only through repositories.
- **Uploads** never touch this server: clients upload directly to Cloudinary using a short-lived signed permission this API issues.

The layering rule is followed consistently: routes → controllers → services → repositories → database. This is a good architecture for this project and does not need changing.

---

# PARTS 2–3 — FINDINGS

Format per finding: category, priority, problem, exact location, consequence, recommended fix.

---

### AUDIT-001

Category: Bug
Priority: Critical

Problem:
The entire hot/controversial ranking feature cannot execute. Two independent defects guarantee it: (1) nothing ever adds a job to the ranking queue, so the ranking worker never runs; (2) even if it ran, its database write is invalid SQL for this schema and would crash every pass.

Where:
- `src/queues/ranking.queue.ts` — queue declared; no `rankingQueue.add(...)` exists anywhere in `src/` (verified by grep).
- `src/workers/ranking.worker.ts:64` — calls `postRepository.updateRankingScores(scores)`.
- `src/repositories/post.repository.ts:282` — casts each id with `${row.id}::uuid`.
- `prisma/schema.prisma:134` — `posts.id` is `String @id @default(uuid())`, which Prisma emits as Postgres **TEXT**, not native `uuid`.

Why it is a problem:
`WHERE p.id = v.id` becomes `text = uuid`, for which PostgreSQL has no operator. The statement fails with `operator does not exist: text = uuid`. Consequence chain: scores stay permanently `0` → both Redis ZSETs stay empty → every "hot"/"controversial" feed request silently falls back to sorting on zeroed columns → **the ranked feeds are actually "newest first" wearing a costume**, on two different endpoints. Three indexed columns, two ZSETs, a worker, a queue, and unit-tested scoring maths exist to serve a feature that has never once run. A reviewer who votes on posts and opens the hot feed sees wrong behavior with no error anywhere.

Recommended solution:
Two small changes, no new infrastructure:
1. Add a producer — a third repeatable job in `initScheduledJobs` (`src/queues/cron.queue.ts`), e.g. every 5 minutes, targeting the existing `"ranking-cron-queue"`.
2. Fix the cast — change `${row.id}::uuid` to `${row.id}::text` (or drop the cast entirely).

Why this solution is better:
It activates ~300 lines of already-written, already-indexed machinery for roughly ten lines of change. Migrating IDs to native `uuid` would also fix it but touches every table for no additional benefit here.

Implementation:

```ts
// src/queues/cron.queue.ts — add inside initScheduledJobs()
await cronQueue.add(
  "rank-feed",
  { action: "RANK_FEED" },          // requires extending CronJobData,
  { repeat: { pattern: "*/5 * * * *" }, jobId: "feed-ranking" }
);
```
(Or enqueue directly onto `rankingQueue`; either is consistent with the existing fixed-jobId pattern.)

```ts
// src/repositories/post.repository.ts:282
Prisma.sql`(${row.id}::text, ${row.hotScore}::double precision, ${row.controversialScore}::double precision)`
```

Note: activating this makes the ZSET path and SQL fallback observable against each other for the first time; expect small drift findings (e.g., soft-deleted ids lingering in a ZSET until the next trim) — the worker already trims and re-reads counters each pass, so exposure is bounded to one interval.

---

### AUDIT-002

Category: Bug
Priority: Critical

Problem:
Both recommendation endpoints return a 500 for every anonymous visitor, despite the service being explicitly written to serve guests.

Where:
- `src/routes/recommendation.routes.ts:9-10` — routes mounted with **no auth middleware at all** (not even `optionalAuth`).
- `src/controllers/recommendation.controller.ts:11,24` — `res.locals.user.userId` read unconditionally.

Why it is a problem:
For a request without a token, `res.locals.user` is undefined, so `.userId` throws a TypeError → global handler → 500. Meanwhile `recommendation.service.ts` contains deliberate guest fallbacks (`getRecommendedPosts(null, …)` handling) and the repository has guest community suggestions — code that can never be reached through HTTP. This is also the clearest testing lesson in the repo: the best-unit-tested service (289 lines) ships broken because the seam that broke (route wiring) was never covered.

Recommended solution:
Add `optionalAuth` to both routes (the identical pattern already exists one file away: `src/routes/user.routes.ts:18`). No service change needed.

Implementation:
```ts
router.get("/communities", optionalAuth, handleGetCommunityRecommendations);
router.get("/posts", optionalAuth, handleGetPostRecommendations);
```

---

### AUDIT-003

Category: Deployment
Priority: Critical

Problem:
The containerized deployment never applies the database schema. A fresh environment boots a healthy-looking stack that fails on every database touch until an operator improvises migrations from outside the container.

Where:
- `Dockerfile:32` — production stage runs `npm ci --omit=dev --ignore-scripts`; Prisma CLI is a devDependency, so no migrate binary ships in the image.
- `Dockerfile:52` — `CMD ["node", "dist/main.js"]` starts serving immediately.
- `compose.yaml:18-22` — `depends_on: service_healthy` orders startup but performs no schema step.

Why it is a problem:
Clone-and-run is this project's primary consumption path. With an empty volume, `/health/ready` reports DOWN and every API call 500s. The raw material exists — one squashed, drift-free migration (`prisma/migrations/20260806233755_forum_db`) — it just is never applied.

Recommended solution:
Migrate-then-start entrypoint. Either vendor the Prisma CLI into the production image and use an entrypoint script (`prisma migrate deploy && node dist/main.js`), or add a one-shot compose migration service. Also add `prisma/seed.ts` while touching this area (faker is already installed) so demos start populated — see AUDIT-040.

Why this solution is better:
No application code changes; the deploy path matches what CI validates.

---

### AUDIT-004

Category: Security / Bug
Priority: Critical

Problem:
The moderation endpoints' request bodies are the only unvalidated bodies in the codebase, and the combination lets a post's author undo a moderator's lock.

Where:
- `src/controllers/post.controller.ts:117-119` — `const body = req.body ?? {}`; `isLocked`/`isPinned` destructured with no Zod schema.
- `src/routes/post.routes.ts:40` — `POST /:id/lock` gated only by `requireAuth` (intentional: authors may lock their own posts).
- `src/services/post.service.ts:207-217` — LOCK authorizes `author OR mod/admin`, then writes whatever boolean arrived.

Why it is a problem:
A moderator locks an abusive thread. The author then sends `POST /api/v1/posts/:id/lock` with `{"isLocked": false}` — they are authorized to call the endpoint (they're the author) and the value comes straight from their body. The lock is silently removed. Additionally, any type garbage (`{"isLocked": "yes"}`) flows into Prisma unchecked, and `reason` on REPORT is unbounded/unvalidated.

Recommended solution:
Create one small Zod schema per action and parse the body inside `toggleModerationFlag`. For LOCK, either forbid the field for non-staff callers or ignore client-supplied state for authors (authors get toggle semantics; staff set explicit state).

Implementation sketch:
```ts
const lockSchema = z.object({ isLocked: z.boolean() });
// in the LOCK branch: if caller is not mod/admin, derive isLocked = !post.isLocked
// instead of trusting the body.
```

---

### AUDIT-005

Category: Bug / Logic
Priority: Critical

Problem:
A community's only moderator can leave the community in one request, leaving it permanently unmoderatable.

Where:
- `src/services/community.service.ts:108-114` — `leaveCommunityAction` calls `deleteMembership` with **no moderator guard whatsoever**.
- Contrast: `revokeModeratorRole` (same file, lines 334-344) refuses when `countModerators <= 1` — the protection was clearly intended but implemented in the demote path, not the leave path.

Why it is a problem:
After the last moderator leaves, nobody can appoint a new one (`assignModeratorRole` requires the caller to already be a moderator), so description/rules/branding become uneditable forever. The only remaining lever is the creator deleting the whole community (see AUDIT-006). There is no race required — it is a single ordinary request.

Recommended solution:
In `leaveCommunityAction`, if the caller's membership role is MODERATOR, apply the same `countModerators > 1` check before deleting. Reuse `communityRepository.countModerators` — do not duplicate the logic.

---

### AUDIT-006

Category: Reliability / Data
Priority: Critical

Problem:
Deleting a community performs an irreversible hard delete that cascades to every membership, post, comment, reply, vote, saved item, and report — bypassing the 30-day recovery window that protects those same rows when deleted individually.

Where:
- `src/services/community.service.ts:197-209` (`deleteCommunityAction` → creator-only check → hard delete).
- `src/repositories/community.repository.ts:185-189` (`delete`).
- `prisma/schema.prisma:121,158,189,192,216,259,275,289` — total cascade chain.
- Follow-up defect: after deletion, `post:<id>` cache entries for destroyed posts are not evicted (`community.service.ts:206-208` clears only three keys), so fully-rendered ghosts remain readable for up to an hour; `feed:advanced:*` and search caches likewise retain them.

Why it is a problem:
One accidental or malicious creator action destroys everything irrecoverably. Every other user-destructive operation in this system is a soft delete with a purge job; communities are the exception with the largest blast radius.

Recommended solution (schema change — requires your approval, see Part 5):
Add `deletedAt DateTime?` to `Community`, filter it in all reads, and let the weekly cron hard-purge handle actual removal (the cascade will still fire at purge time — acceptable, since it happens only after the recovery window). If you prefer zero schema change now, the minimum mitigation is: require an explicit confirmation token in the DELETE body and evict `feed:advanced:*` + affected `post:<id>` keys after deletion.

Risk/impact: adding a column is backward-compatible (`NULL` = active); all community reads must gain `deletedAt: null` or deleted communities reappear. Migration impact: one additive column, no data rewrite.

---

### AUDIT-007

Category: Security / Bug
Priority: Critical

Problem:
There is no way to grant a platform role through the API. `users.role` starts at USER for everyone, and nothing ever changes it — so every endpoint guarded by `requireModerator`/`requireAdmin` is unreachable on a fresh deployment except via manual SQL.

Where:
- `grep` across `src/`: no route/service writes `role`. Only `role.middleware.ts` reads it.
- Affected dead endpoints: `GET /metrics` (`src/routes/metrics.routes.ts:12-13`), `POST /posts/:id/pin`, `POST /comments/:id/lock`, `POST /comments/:id/remove`.

Why it is a problem:
A third of the authorization surface ships broken-by-default. Moderation features demonstrated in the README cannot be exercised without hand-editing the database — which a reviewer will not know to do.

Recommended solution:
`POST /admin/users/:id/role` behind `requireAdmin`, plus a bootstrap story for the first admin (seed script sets it, or an env-var-nominated bootstrap username honored once at startup). This pairs naturally with the seed script from AUDIT-003/040. Keep it minimal — no permission matrices, no appeal workflows.

---

### AUDIT-008

Category: Reliability
Priority: High

Problem:
Creating a comment fails outright when Redis is down, because notification enqueue is awaited without a catch *after* the comment row has already committed.

Where:
- `src/services/comment.service.ts:33-40` (reply path) and `62-69` (top-level path) — `await sendInternalNotification({...})` with no error handling.
- Same bare-await pattern: `src/services/post.service.ts:222-229` (LOCK notice).
- Asymmetric contrast in the same codebase: login notice uses `.catch(log)` (`src/services/auth.service.ts:131-139`); registration awaits bare (`auth.service.ts:44`) so Redis-down also turns registration into a 500 *after* commit.

Why it is a problem:
Sequence under Redis outage: comment inserted → enqueue rejects → client gets 500 → client retries → duplicate comments (no `jobId` dedupe exists either). The socket emit two lines below is correctly wrapped in try/catch with a comment saying realtime "must not fail the request"; the enqueue one line earlier needs the same treatment.

Recommended solution:
Centralize the policy in `sendInternalNotification` (`src/services/notification.service.ts:49`): fire-and-forget with a logged rejection (`.catch(logger.error)` inside the helper). Callers stop caring. Optionally add deterministic `jobId`s (`recipient:type:target`) so BullMQ dedupes retry storms. A full transactional outbox is NOT recommended — see Part 13.

---

### AUDIT-009

Category: Reliability
Priority: High

Problem:
Email delivery failures are recorded as successes, so BullMQ's retry machinery never fires for the most important email path in the system.

Where:
- `src/utils/mailer.ts:52-54` — `sendSystemEmail` catches every SMTP error and logs it; the promise always resolves.
- `src/workers/email.worker.ts:29-34` — the `failed` handler exists but can never trigger from send failures.
- Password-reset and verification emails flow through here (`src/services/auth.service.ts:264,293`).

Why it is a problem:
An undeliverable password-reset email completes as a green job. Retries (3 attempts, exponential backoff — configured in `email.queue.ts`) are dead letters by construction. Metrics lie too: `completed` counts include mail that never left the building. Notification jobs, by contrast, fail honestly — email has *weaker* delivery guarantees than chat notifications.

Recommended solution:
Make `sendSystemEmail` throw (or return `{delivered: boolean}` that the worker asserts). This is a deliberate behavior change: transient SMTP blips now genuinely retry; permanent failures land in the retained failed set visible in Bull Board. Keep the lazy-transporter memoization. Mask the recipient address in logs while editing this function (currently logged in full — PII).

---

### AUDIT-010

Category: Security
Priority: High

Problem:
The refresh-token denylist fails open when Redis is unavailable: a token that was explicitly logged out becomes usable again.

Where:
- `src/utils/redis.ts:128-139` — `exists()` swallows errors and returns `false`.
- `src/repositories/tokenBlacklist.repository.ts:24-27` — `isBlacklisted` returns that `false`.
- Consumed by `src/services/auth.service.ts:152-155`.

Why it is a problem:
Every other degrade-gracefully decision in the Redis facade trades only performance; this one trades security — a revoked 7-day credential works again for its remaining life. Note the asymmetry within the same feature: `blacklist()` uses `getClient().set()` directly (throws on outage, caught upstream at logout) while `isBlacklisted()` silently lies.

Recommended solution:
On error, fail closed for this specific check (throw → refresh returns 401/503). Refresh attempts are low-volume; requiring a healthy Redis to mint access tokens is the correct posture, and readiness probing already reports Redis state.

---

### AUDIT-011

Category: Security
Priority: High

Problem:
The account-lockout counter never resets after the lock window expires, enabling indefinite remote account locking at one request per 15 minutes.

Where:
- `src/services/auth.service.ts:69-98` — `loginAttempts` resets only on successful login (`111-114`).
- `src/repositories/user.repository.ts:386-411` — at ≥5 attempts the transaction stamps `lockUntil = now + 15 min`.

Why it is a problem:
Window expires → attacker sends one more wrong password → counter goes 6 ≥ 5 → locked another 15 minutes. Repeat forever. An unauthenticated attacker who knows only an email address can keep any account locked indefinitely. Secondary issue: the lockout check runs *after* `bcrypt.compare` (`67` before `69`), so locked accounts still burn ~70 ms CPU per attempt — the lockout is useless as a CPU-exhaustion defense.

Recommended solution:
When a lock window has expired, clear both fields and evaluate the attempt fresh (i.e., treat expiry as a reset point). Move the `lockUntil` check above the bcrypt comparison. Both changes are local to `loginUser`.

---

### AUDIT-012

Category: Reliability
Priority: High

Problem:
The rate limiter's behavior during a Redis outage is unverified but plausibly fatal: it may turn a Redis hiccup into whole-API unavailability. Separately, no `trust proxy` is configured, so behind any reverse proxy all clients share one IP bucket.

Where:
- `src/middlewares/rateLimit.middleware.ts:16-21,39-45` — store wired via `redis.getClient().call(...)`, deliberately bypassing the facade's swallow-errors policy.
- express-rate-limit default is `passOnStoreError: false` → store rejection propagates → global handler → 500, for every request, starting at the first middleware.
- `src/app.ts` — no `app.set("trust proxy", ...)` anywhere (verified).
- Aggravating: the global limiter covers **everything** mounted after it (`src/app.ts:65`), including `/health/*`, `/metrics`, `/admin/queues`, and `/api-docs` — health checks and Prometheus scrapes consume the same 100-per-10-min bucket as traffic.

Why it is a problem:
Every other Redis consumer degrades gracefully *by design*; the one component gating 100% of traffic plausibly does the opposite. And behind a proxy, either everyone shares one bucket (limiter throttles innocent users collectively) or — worse for correctness — the limiter keys on an internal IP and effectively never limits anyone per-client.

Recommended solution:
1. Empirically verify the failure mode (stop Redis mid-request in an integration test) — do not act on library defaults alone.
2. Choose and codify a posture: `passOnStoreError: true` (fail-open limiting, matching the facade philosophy) or an in-memory fallback store.
3. Set `app.set("trust proxy", 1)` (or the appropriate hop count) and document the deployment assumption.
4. Exempt `/health/*` (and ideally `/metrics`) from the global bucket.

---

### AUDIT-013

Category: Bug
Priority: High

Problem:
The post-detail cache serves stale vote tallies and stale comment counts for up to an hour because the mutations that change them don't evict it.

Where:
- `src/services/post.service.ts:82-93` — `post:<id>` cached 3600 s including `upvoteCount/downvoteCount/score/_count.comments`.
- `src/services/vote.service.ts:19-21,51` — voting evicts only `post:<id>:vote_metrics:*`, never `post:<id>`.
- `comment.service.ts:createComment` — evicts nothing at all.

Why it is a problem:
For up to an hour after voting, `GET /posts/:id` and `GET /posts/:id/votes` show different numbers for the same post; after commenting, the detail page count lags an hour. Users see write-confirmed state contradicted by a later read.

Recommended solution:
Evict `post:<id>` in `castVote` (one line next to the existing eviction) and in `createComment`/moderation paths. Alternatively shrink the TTL, but explicit eviction matches the invalidation discipline used everywhere else in the codebase.

---

### AUDIT-014

Category: Performance / Security
Priority: High

Problem:
`GET /posts` accepts an unbounded `limit`; `?limit=100000` executes `take: 100001` with three joins per row on a public endpoint.

Where:
- `src/validators/post.validator.ts:75-82` — `limit` stays a string; the comment claims "the service layer owns the numeric coercion **and clamping**".
- `src/controllers/post.controller.ts:37` — coerces with `parseInt`, never clamps.
- `src/services/post.service.ts:145-170` → `post.repository.ts:187` — `filters.limit || 10` passes straight through.

Why it is a problem:
The promised clamp does not exist anywhere. Ten such requests exhaust the 10-connection pool (see AUDIT-022) and every other request queues silently. The correct pattern already exists in the same file — `postSearchSchema` clamps via `.pipe(z.number().int().min(1).max(50))` (`post.validator.ts:149-153`) — and the sibling `/feed` endpoint has been clamped (1–50) since commit `7e575f7`.

Recommended solution:
Apply the same pipe-clamp to `postFeedQuerySchema.limit` and delete the now-false comment. Also delete the misleading dead export `getAdvancedPostsFeedSchema` (`post.validator.ts:135-141`), whose numeric `limit` suggests validation that doesn't happen.

---

### AUDIT-015

Category: Bug
Priority: High

Problem:
Soft-deleted content leaks back onto public lists: author profiles and community pages return deleted posts, and profile pages return deleted comments.

Where:
- `src/repositories/user.repository.ts:269-274` — `findPostsByAuthorId`: no `deletedAt` filter.
- `src/repositories/user.repository.ts:279-284` — `findCommentsByAuthorId`: no `deletedAt` filter (extends the previously documented post-only finding).
- `src/repositories/community.repository.ts:126-131` — `findPostsByCommunityId`: no `deletedAt` filter, no pagination, no shared include.
- These feed public endpoints: `GET /users/:username/(posts|comments)`, `GET /communities/:slug/posts`.

Why it is a problem:
A user deletes a post; it remains visible indefinitely on their profile and its community's page. This contradicts the system-wide soft-delete contract enforced everywhere else (`findById`, feed, search, votes all filter `deletedAt: null`). Bonus inconsistency: these paths also skip `postListInclude`, so rows come back shaped differently from every other list.

Recommended solution:
Add `deletedAt: null` to all three queries and reuse `postListInclude` (it is exported precisely for this). Add `take` bounds while touching them.

---

### AUDIT-016

Category: Performance / Security
Priority: High

Problem:
Search is leading-wildcard substring matching with no index support, exposed publicly and unauthenticated — the only endpoint family whose cost grows linearly with total content volume.

Where:
- `src/repositories/post.repository.ts:235-256` — `title ILIKE %q% OR content ILIKE %q%` (sequential scan over the unbounded `content` column).
- Same pattern: `community.repository.ts:233-248`, `user.repository.ts:356-379` (cheaper columns).
- No `tsvector`/GIN/pg_trgm anywhere in `prisma/schema.prisma`.

Why it is a problem:
At small scale fine; it degrades linearly forever, and caching (180–300 s, never invalidated — edited/deleted posts persist in results) shields only repeated identical queries. Results have no relevance ordering.

Recommended solution:
PostgreSQL-native full-text search: generated `tsvector` column + GIN index + `websearch_to_tsquery`/`ts_rank` via `$queryRaw` (precedent exists: `updateRankingScores`). Keeps search inside Postgres; no new infrastructure. Schema addition requires your approval (Part 5): additive generated column + index, no data rewrite beyond index build.

---

### AUDIT-017

Category: Bug / Design
Priority: High

Problem:
The comment-list endpoint has three compounding defects: it is the only read endpoint requiring authentication; it returns a flat, unbounded array; and its `deletedAt: null` filter defeats the stated purpose of comment soft-deletion.

Where:
- `src/routes/comment.routes.ts:14` — `requireAuth` on `GET /post/:postId`.
- `src/repositories/comment.repository.ts:42-53` — no `take`, no depth handling, filters out deleted parents.
- `src/controllers/comment.controller.ts:27` — `req.params.postId as string`, the sole unvalidated param read in the app (a garbage id returns `200 {data: []}` instead of 404).
- Related: moderator-removed placeholder text (`"[Comment removed by moderator]"`, `comment.repository.ts:90-98`) is written to be displayed but the row is filtered out by the same read — dead content.

Why it is a problem:
Visitors can read posts but not their replies (inconsistent with every sibling read). A 50k-comment post returns 50k rows uncached. When a parent is deleted, replies arrive pointing at a missing node — the thread collapses in the client instead of the database, contradicting the repository's own docstring ("so nested replies keep a valid parent").

Recommended solution:
Drop `requireAuth` (add `optionalAuth` if block-filtering is desired later); validate `postId` with the existing UUID param-schema pattern; paginate with cursor; keep deleted rows in the payload projected to `{id, parentId, deletedAt}` placeholders so threads hold shape. Bundle the placeholder-display fix here.

---

### AUDIT-018

Category: Error handling
Priority: High

Problem:
Prisma error codes are unmapped almost everywhere, so ordinary races and conflicts surface as opaque 500s.

Where:
- `src/middlewares/errorHandler.ts` — recognizes `ZodError` and `AppError` only.
- Exactly one intentional mapping exists: `isRetryableVoteConflict` (`vote.repository.ts:125-130`).
- Concrete manifestations: duplicate registration race → `P2002` → 500 instead of intended 409 (`user.repository.ts:13-19` check-then-act vs unique index); concurrent edit/delete racing a delete → `P2025` → 500; community create race → `P2002` → 500.

Why it is a problem:
Clients can't distinguish "conflict, retry makes sense" from "server bug". The intended 409s exist in code paths that lose the race they were written for.

Recommended solution:
Extend `globalErrorHandler` with a `PrismaClientKnownRequestError` branch: `P2002` → 409, `P2025` → 404, `P2003` → 400/409 with generic message. ~15 lines, removes a whole class of mystery-500s without touching call sites.

---

### AUDIT-019

Category: Security
Priority: High

Problem:
The community-invite endpoint requires nothing beyond being logged in: any user can send unlimited invitation notifications for any community to any user.

Where:
- `src/services/community.service.ts:215-239` — checks community and target exist; never checks the sender's membership/moderator status.
- No duplicate suppression, no rate limit beyond the shared IP bucket.

Why it is a problem:
Built-in harassment/spam channel: unlimited forged-personal invites rendered with the community's name, delivered realtime and persisted.

Recommended solution:
Require the sender to hold a membership (MEMBER or MODERATOR — pick one deliberately) in that community. Optionally suppress repeats (unique constraint on recipient+community+recent-window or simply a `jobId`). One membership lookup fixes it.

---

### AUDIT-020

Category: Security / Bug
Priority: High

Problem:
Community slugs are unsanitized lowercased names; hostile characters flow into URL path segments and Redis key patterns swept with wildcard deletion.

Where:
- `src/services/community.service.ts:59` — `slug = data.name.toLowerCase()`. No trimming, charset allowlist, or normalization.
- Downstream hazards: `community:slug:<slug>` / `feed:community:<slug>` keys (a slug containing `*` poisons `delPattern("feed:community:*")`-family sweeps), and slug-addressed routing breaks on `/ ? # %` etc.

Why it is a problem:
Cache-correctness hazard plus broken addressing from ordinary names like "C++ & Friends". The E2E fixture bug history shows how much pain one character-class mismatch causes.

Recommended solution:
Derive the slug through a normalizer (lowercase → strip diacritics → replace non `[a-z0-9-]` runs with `-` → collapse dashes → trim dashes), and enforce the result with a regex on `createCommunitySchema`. Existing rows are unaffected until renamed.

---

### AUDIT-021

Category: Validation
Priority: High

Problem:
Username updates skip the character-set rule that registration enforces.

Where:
- `src/validators/auth.validator.ts` — `registerSchema.username` enforces `^[a-zA-Z0-9_]+$`; `updateMeSchema.username` checks length only.
- Consumed by `PATCH /api/v1/auth/me` (`src/services/auth.service.ts:210-220`).

Why it is a problem:
`{"username": "a b<script>"}` is accepted; usernames are URL-addressing keys (`/users/:username`) and render in UIs. Inconsistent contracts between create and update are a classic drift bug.

Recommended solution:
Share one username literal (exported const or `z.string().regex(...)` reused by both schemas — DRY, no duplication).

---

### AUDIT-022

Category: Reliability / Performance
Priority: High

Problem:
Nothing bounds worst-case latency: no statement timeout, no connection-wait timeout, no pool sizing, no server-level request timeouts.

Where:
- `src/utils/prisma.ts:8` — bare `new pg.Pool({ connectionString })`; pg defaults: `max: 10`, infinite wait, no `statement_timeout`.
- `src/main.ts:31` — plain listen; Node defaults (requestTimeout 300 s) are generous.
- Nothing in `compose.yaml` configures server-side timeouts either.

Why it is a problem:
Combined with AUDIT-014's unbounded queries, a handful of slow requests pin all 10 connections; every subsequent request queues invisibly while `/health/ready` keeps reporting UP (its probe is itself queued behind the pool... though `SELECT 1` would eventually starve too — either way the signal arrives very late). Silent pile-up is the worst failure shape: no errors, just ever-growing latency.

Recommended solution (~10 lines, config only):
`pg.Pool({ max: 10, connectionTimeoutMillis: 5_000, statement_timeout: 5_000 })` (pass a longer statement budget for the batched ranking UPDATE if needed), and optionally set explicit `server.requestTimeout/headersTimeout`. Converts silent pile-ups into fast, visible 503/500s.

---

### AUDIT-023

Category: Observability
Priority: High

Problem:
Prometheus cannot scrape `/metrics` because it sits behind `requireAuth + requireAdmin` (bearer JWT), and nothing consumes the exposed metrics anyway.

Where:
- `src/routes/metrics.routes.ts:10-14`.
- Gauges/counters exist (`src/utils/metrics.ts`), refreshed per scrape; the dashboard omits `rankingQueue` (`src/queues/dashboard.ts` registers only email/notification/cron; `syncBullMQMetrics` same, lines 40-44).

Why it is a problem:
Metrics that no scraper can reach are decoration. On any fresh deployment this endpoint additionally 403s for everyone due to AUDIT-007.

Recommended solution:
Protect `/metrics` with the same constant-time basic-auth middleware used for `/admin/queues` (`queueAuthMiddleware`) — scrapers speak basic auth natively. Register `rankingQueue` on both the dashboard and `syncBullMQMetrics` while there.

---

### AUDIT-024

Category: Architecture
Priority: High (conditional — High only if multi-instance is ever a goal)

Problem:
Real-time fan-out is coupled to a single process. Rooms live in per-process memory; the notification worker emits through a module-level singleton that assumes it shares the heap with the socket server.

Where:
- `src/socket/socket.server.ts:10` — `let io` module singleton; no `@socket.io/redis-adapter` in package.json.
- `src/workers/notification.worker.ts:32-49` — emits from the worker context.

Why it is a problem:
Today (one instance, embedded workers): correct. Tomorrow (two instances): users connected to instance A receive nothing emitted on B; realtime silently degrades to polling (no data loss — persist-then-push discipline means DB wins). This is the one genuine shared-state blocker to horizontal scaling.

Recommended solution:
NO CHANGE NEEDED now. Write the constraint down (ADR): "single instance until X; scaling requires `io.adapter(redisAdapter(...))` + sticky sessions." Do not install the adapter preemptively — it adds two connections and an operational requirement (sticky sessions) that buys nothing at replica count 1.

---

### Medium priority findings

Each follows the same format, compressed.

#### AUDIT-025 — Dual feed implementations disagree
Category: Architecture | Priority: Medium
`GET /feed` (`feed.controller/service/validator`) and `GET /posts` (`getActivePosts` path) serve one concept with different limit clamping (50-bounded vs unbounded), different cursors (ZSET rank-offset vs UUID keyset), different envelopes (`meta.nextCursor` vs top-level), different viewer-vote handling, and two serializers writing one shared `feed:advanced:` keyspace. Fix direction: consolidate into one schema/service/envelope; pick cursor grammar per sort path and document it. Complexity Low-Medium; highest design-value cleanup in the repo.

#### AUDIT-026 — Per-viewer cache keys force keyspace scans on hot writes
Category: Performance | Priority: Medium
`post:<id>:vote_metrics:<viewerId>` (`post.service.ts:269-293`) and `profile:username:*:viewer:*` (`user.service.ts:30-35`) fragment caches per reader; invalidating them requires SCAN sweeps on **every vote** (`vote.service.ts:20`) and every follow/block (four sweeps, `user.service.ts:105-174`). Any single post edit also sweeps all community feeds (`post.service.ts:116,135`). Fix: adopt the viewer-layered pattern the feed already uses (viewer-agnostic payload + post-lookup of the viewer's vote) and prefer exact-key deletes where keys are deterministic. Complexity Low.

#### AUDIT-027 — Cursors are not deterministic
Category: Bug | Priority: Medium
Feed/search orderings lack an `{id}` tiebreaker (`post.repository.ts:204-210,254`); rows tied on sort keys can skip or repeat across pages. Fix: append `{ id: "desc" }` to every multi-key `orderBy`. Complexity trivial.

#### AUDIT-028 — Double-click can silently discard a vote; retry unguarded
Category: Bug | Priority: Medium
Two concurrent first-votes resolve to a deleted vote (`applyVote` atomic but not intent-preserving, `vote.repository.ts:63-68`); the single retry (`vote.service.ts:48`) can itself raise `P2002` under 3-way contention → unmapped 500. Counters stay consistent — the user's intent doesn't. Fix: on retry, re-check and preserve first-intent; wrap retry in the same conflict predicate. Complexity Low.

#### AUDIT-029 — Comment SAVE is check-then-act where upsert exists
Category: Bug | Priority: Medium
`comment.service.ts:156-166` reads-then-creates despite the codebase-standard upsert used by `postRepository.save`, follow/block joins; concurrent save → `P2002` → 500. Fix: upsert on `userId_commentId`. Trivial.

#### AUDIT-031 — Saved items are write-only
Category: Missing feature | Priority: Medium
Users can save/unsave posts (`post.routes.ts:31-32`) and comments (`comment.routes.ts:20`) but no endpoint lists saves. Tables and idempotent writes exist; one paginated read each completes the feature.

#### AUDIT-032 — `NEW_FOLLOWER` notification never emitted
Category: Dead feature | Priority: Medium
Enum value exists in schema/queue types/repository union (`notification.repository.ts:3-8`) but no producer calls it — following someone notifies nobody. Either emit it in `followUserAction` (one `sendInternalNotification`) or remove the enum member.

#### AUDIT-033 — Notifications: unpaginated lists, no unread count
Category: Performance / UX | Priority: Medium
`findAllByRecipientId`/`findUnreadByRecipientId` (`notification.repository.ts:25-42`) are unbounded finds despite an ideal `(recipientId, isRead, createdAt)` index; no count endpoint; the realtime event carries the row, not totals. Fix: unread-count endpoint + keyset pagination. Low complexity.

#### AUDIT-034 — Reports vanish into a void
Category: Missing feature | Priority: Medium
`report.repository.ts` is create-only; `Report`/`CommentReport` have no status/resolution columns, no uniqueness on (reporter,target), no triage surface; reasons unvalidated/unbounded (`post.controller.ts:118`, `comment.controller.ts:66`). Minimum loop: moderator-facing list + status field + bounded reason.

#### AUDIT-035 — Login-attempt increment is not truly atomic
Category: Correctness | Priority: Medium
`incrementLoginAttemptsAtomic` (`user.repository.ts:386-411`) is SELECT-then-UPDATE inside a transaction; under READ COMMITTED two concurrent failures can both read N and write N+1, under-counting. Exposure is bounded by the IP limiter. Fix: `UPDATE users SET login_attempts = login_attempts + 1 ... RETURNING` via `$executeRaw`/`$queryRaw`, computing `lockUntil` in SQL. Rename or fix the comment either way.

#### AUDIT-036 — Moderator-management races
Category: Correctness | Priority: Medium
`revokeModeratorRole` counts-then-demotes outside a transaction (`community.service.ts:336-350`) — two simultaneous demotions can strand zero moderators; `assignModeratorRole` is check-then-act where `upsertMembership` already exists unused (`community.repository.ts:102-112`). Fix: conditional UPDATE (`UPDATE memberships SET role='MEMBER' WHERE ... AND (SELECT count(*) ...) > 1`) or serialize via transaction; upsert for assign.

#### AUDIT-037 — Role systems don't compose; predicate triplicated
Category: Architecture | Priority: Medium
Global MODERATOR ≠ community moderator; comment lock/remove use the global role only (`comment.routes.ts:21-32`) while post PIN double-checks in route+service; `isModOrAdmin` reimplemented in `role.middleware.ts` and twice in `modifyPostModerationState`. Fix: extract one `isModOrAdmin(role)` helper; decide and document that comment moderation is global-scoped (or make it community-scoped consistently). Do NOT introduce a policy engine.

#### AUDIT-038 — Tests are never type-checked; coverage never enforced
Category: Testing | Priority: Medium
`tsconfig.json` excludes `tests/` (verified), so CI's build gate never sees test code — fixture bugs survived exactly because of this; no coverage thresholds in any jest config (`jest.config.cjs` collects coverage from `src/services/**` only). Fix: committed `tsconfig.test.json` + `typecheck:tests` script in CI; optionally a modest threshold (e.g. services ≥80%) rather than vanity gates.

#### AUDIT-039 — Observability gaps
Category: Observability | Priority: Medium
`traceId` stops at the HTTP boundary (never stamped into jobs — a failed email can't be joined to its request); email worker logs full recipient addresses (`email.worker.ts:16`); zero cache hit/miss instrumentation despite caching being the central performance claim; logged latency had a historical 10¹² bug caught only by eyeballing output (fixed; no regression assertion added). Fix: pass traceId in job payloads, mask recipients, two counters in the Redis facade. Explicitly do NOT add OpenTelemetry.

#### AUDIT-040 — No seed script
Category: Deployment/DX | Priority: Medium
`package.json` has no seed; every demo/interview run starts empty, hiding the feed/ranking features most worth showing. Faker is already a devDependency. Fix: `prisma/seed.ts` (users → communities → posts → votes) wired via `prisma.seed`; pairs with AUDIT-003.

#### AUDIT-041 — Feed ZSET cursor accepts garbage
Category: Validation | Priority: Low/Medium
`feed.service.ts:35` — `parseInt(filters.cursor, 10)` on a free-form string (`feed.validator.ts:18-19`); non-numeric input yields NaN passed to `zrevrange` (runtime error → 500), negative offsets allowed. Fix: validate as non-negative integer string in the schema (`.pipe(z.number().int().min(0))` equivalent) or clamp in service.

#### AUDIT-042 — Orphaned/dead code inventory
Category: Maintainability | Priority: Low
Zero-reference files/deps: `tests/setup.ts`, `tests/helpers/mock-common.ts`, `@eslint/js` devDependency, `getAdvancedPostsFeedSchema` export (misleading — see AUDIT-014), `redis.flushdb()/reconnect()` are test-only conveniences living on the prod facade (document or move to test helpers). Delete with a note; none affect runtime.

#### AUDIT-043 — Low-priority polish group
Category: Other | Priority: Low
Collected minor items, none urgent: CORS rejection surfaces as 500 not 403 (`app.ts:44` error → handler); `process.env.NODE_ENV` read directly in `auth.controller.ts:47,89` bypassing `env.app.nodeEnv`; `removePost` sends `204 .json()` (`post.controller.ts:91`) — works by accident, sibling uses `.end()` correctly; empty-body PATCH performs a real write + two broad cache sweeps (`updatePostSchema` permits `{}`); `createComment` existence check uses the heavy `findById` (3 joins + COUNT) when `findUniqueById` suffices (`comment.service.ts:16`); `findActiveById` uses `findUnique` with null-filter while `postRepository.findById` uses `findFirst` for the identical need — contradictory resolutions of one question; locked-post returns 400 for comments but 403 for votes; blacklist keys embed the full JWT (~250 bytes, no separator); roster endpoints public + unpaginated + lacking usernames (`community.repository.ts:136-147`); `LINK` post type cosmetic (no url column/validation); health-route typo "dtabase" (`health.routes.ts:61`); `pino-pretty` is a runtime dep.

---

# PART 4 — PRIORITY DISTRIBUTION (summary)

| Priority | Count | Findings |
|---|---|---|
| Critical | 7 | AUDIT-001 … AUDIT-007 |
| High | 17 | AUDIT-008 … AUDIT-024 |
| Medium | 18 | AUDIT-025 … AUDIT-042 |
| Low | grouped | AUDIT-043 |

Nothing above is style preference; every card identifies a concrete failure mode, security gap, or unreachable/broken capability.

---

# PART 5 — DATABASE AUDIT

**State (verified):**
- PostgreSQL 17, Prisma 7 driver-adapter over a raw `pg.Pool`. 13 models, 5 enums, snake_case mapping convention, explicit `onDelete` everywhere, timestamps everywhere.
- Exactly one migration (squashed baseline `20260806233755_forum_db`); previously verified drift-free against the schema.
- IDs are TEXT uuids (root cause of AUDIT-001's SQL bug).
- Soft deletes: User/Post/Comment yes; Community no (AUDIT-006).
- Indexes match the read paths well: composite `(communityId, createdAt desc)`, `(authorId, createdAt desc)`, three `(deletedAt, <score> desc)` feed indexes; `votes(userId,postId)` unique + `(postId,type)`; `memberships(userId,communityId)` unique + `(communityId)`; notifications `(recipientId,isRead,createdAt desc)`. Token lookups are unique-index backed.
- Transactions used where integrity demands: `applyVote`, `createWithModerator`; mislabeled in `incrementLoginAttemptsAtomic` (AUDIT-035); absent where needed (`resyncCounters` non-transactional reconciliation tool — test-only caller; acceptable if labeled, dangerous if trusted).
- Pagination: cursor-based with take+1 lookahead (good); missing tiebreakers (AUDIT-027); missing bounds (AUDIT-014); missing entirely on comments/rosters/lists (AUDIT-017, roster in AUDIT-043).
- Search: unindexable ILIKE (AUDIT-016).
- N+1: properly closed on the hot paths (`findViewerVotes` batch, `findByIdWithViewerVote` fold, `_count` includes). Remaining aggregate-per-row cost: `_count.comments` computed per feed row (no denormalized comment count) — acceptable at current scale; denormalize only if profiling demands.
- Connection handling: **unconfigured pool** (AUDIT-022).

**Database changes recommended (none applied; each needs your approval):**

| # | Change | Why | Risk | Impact |
|---|---|---|---|---|
| 1 | `Community.deletedAt` column | AUDIT-006 soft-delete parity | Deleted communities could reappear if any read misses the filter — grep all `community.find*` when applying | Additive column; no data rewrite |
| 2 | Generated `tsvector` + GIN on posts(title, content) | AUDIT-016 indexed relevance search | Index build cost once; raw-SQL query replaces Prisma search | Additive; Prisma model unchanged |
| 3 | (Optional) native `uuid` PKs | Fixes AUDIT-001 root cause class | Full table rewrite ×13 — NOT worth it; use `::text` cast instead | Skip |

---

# PART 6 — AUTHENTICATION & SECURITY AUDIT

**Solid (NO CHANGE NEEDED):** bcrypt cost 10 + per-call salt; constant-work login (DUMMY_HASH, tested); enumeration closed on forgot-password/resend; compound refresh secret = free bulk revocation on password change (genuinely elegant); httpOnly/secure/sameSite-strict cookie; single-use reset tokens closed atomically; CSRF posture correct without tokens (only cookie-authenticated endpoint is `/refresh`, whose response a cross-site attacker cannot read — reasoning documented); IDOR systematically closed with ownership checks before mutation; blocked profiles 404 not 403; mass assignment impossible via closed Zod objects; helmet; timing-safe dashboard credentials with fail-fast env; `.env*` excluded from image.

**Gaps:** see AUDIT-004 (moderation body/author unlock), 007 (no role grant), 010 (fail-open denylist), 011 (lockout loop + ordering), 012 (trust proxy/fail-mode), 019 (invites), 021 (username charset), plus: no access-token revocation (accepted trade-off, 15-min bound — leave as-is); no content sanitization (stored verbatim — acceptable if clients escape; consider documenting rather than adding sanitizer deps); secrets management is env-only (fine at this scale).

---

# PART 7 — REDIS & BACKGROUND JOB AUDIT

**Redis usage map (all verified):** refresh denylist (`blacklist:token<jwt>`, self-expiring); rate-limit counters (global + `rl:auth:`); caches — `post:<id>` 1 h, `post:<id>:vote_metrics:<viewerId>` 60 s, `feed:advanced:<hash>` 5 min, `feed:community:<slug>` 5 min, `community:slug:<slug>` 24 h (excellent design, invalidation complete), `communities:list` 30 min, search caches 3–5 min (never invalidated), per-viewer profiles 1 h; ranking ZSETs (declared, empty — AUDIT-001); BullMQ storage (4 queues; Redis AOF persistence enabled in compose so queued jobs survive restarts — good).

**Outage behavior:** facade consumers degrade to misses/writes-with-stale-cache (by design); denylist fails open (AUDIT-010); comment creation fails (AUDIT-008); limiter plausibly fatal (AUDIT-012); login/logout survive; invite fails wholesale (acceptable).

**Jobs:** retries configured sensibly (email 3× exp from 5 s; notifications 2× fixed 2 s; removeOnComplete/Fail caps); repeatables idempotent via fixed jobIds; connection registry enables clean shutdown (good engineering); graceful shutdown drains in dependency order with 10 s force-exit. Gaps: email failures recorded as success (AUDIT-009); enqueue-after-commit (AUDIT-008); no jobId dedupe; ranking queue invisible to dashboard/metrics (AUDIT-023); traceId not propagated (AUDIT-039). Worker crash = process crash (embedded) — acceptable single-instance; BullMQ stalled-job recovery applies if split later.

---

# PART 8 — TESTING AUDIT

**Structure:** unit (9 service suites, mocked, strict mock reset), integration (8, real PG+Redis via Testcontainers owned by shared globalSetup, `runInBand`), E2E (14 files/6 domains, supertest full-stack). Shared fixtures/helpers/lifecycle with proper teardown (queues closed, redis flushed between tests to keep limiter counters honest). This tier separation is correct: units own business-rule branches, integration owns DB semantics, E2E owns HTTP contracts — I found no meaningful duplication of responsibility.

**Strong:** property-style assertions (timing defence, hash non-exposure, cross-user isolation, 12-voter concurrency tally, corrupted-counter reconciliation). The concurrency tests assert real guarantees.

**Gaps:** tests never type-checked (AUDIT-038); coverage collected but ungated, services-only; known blind spots map 1:1 to shipped bugs — no test sends author-lock-with-body (AUDIT-004), executes `updateRankingScores` (AUDIT-001), drives community-moderation HTTP routes, exercises lockout arming end-to-end (AUDIT-011), or asserts cache invalidation (AUDIT-013). Orphaned files AUDIT-042. Recommended additions are targeted, not voluminous: one integration test per critical fix above beats a dozen happy-path E2E variants.

---

# PART 9 — DOCKER & DEPLOYMENT AUDIT

**Good:** 3-stage alpine build; non-root `node` user; HEALTHCHECK hitting the real deep-readiness probe; `.dockerignore` excludes `.env*`; compose wires Postgres 17 + Redis 7 with healthchecks, AOF persistence, loopback-only host ports; CI builds the image.

**Blocking gap:** no migrate-on-boot (AUDIT-003) and no seed (AUDIT-040). Minor: production stage copies generated Prisma client to both `dist/generated` and `src/generated` (works; add a comment explaining why, since it looks redundant); `pino-pretty` rides into prod images (dev-only convenience — move behind NODE_ENV-aware import or accept it).

**Deployability verdict:** realistically deployable today as **single docker-compose host or one small VM** once AUDIT-003 is fixed. Kubernetes/multi-instance is unnecessary (see Part 13). Managed Postgres + managed Redis + one container (Fly.io/Railway/ECS-one-task style) fits this architecture with zero code changes after AUDIT-012's trust-proxy setting.

---

# PART 10 — CI/CD AUDIT

**Pipeline (verified):** quality-check (validate schema → generate client → biome ci → tsc build → unit+coverage artifact) → integration-tests and e2e-tests (Testcontainers, `docker info` preflight, parallel branches) → docker-verification (compose config + buildx build with gha cache). Concurrency cancellation, least-privilege `contents: read`, pinned Node via `.nvmrc`, npm cache. Solid overall.

**Should change:**
1. Add `typecheck:tests` job/step (AUDIT-038) — the suite is 7,700 lines the compiler never sees.
2. Coverage thresholds or drop the pretense of collecting them (currently decorative).
3. docker-verification builds the image but never runs it — add a smoke run (`docker run -d` + poll `/health/live`) so image-level regressions (missing generated client, bad CMD) fail CI instead of deploy day.
4. Integration/e2e jobs reinstall all deps (npm cache helps; fine) — no change needed.
5. No CD — correct omission for now; document that deploys are manual.

---

# PART 11 — PERFORMANCE AUDIT

Likely bottleneck order as users grow (no fabricated numbers; qualitative from code):

| Load | What breaks first |
|---|---|
| 50 users | Nothing. Comfortable. |
| 100 | Unbounded-limit abuse (AUDIT-014) if triggered; otherwise fine. |
| 500 | Pool starvation risk under slow queries (AUDIT-022) + search scans growing with content volume (AUDIT-016). Comment-list payloads on big threads (AUDIT-017). |
| 1,000 | Per-write SCAN sweeps (AUDIT-026) tax Redis on the hottest endpoint; stale-cache contradictions (AUDIT-013) increasingly noticed; notification list loads (AUDIT-033) heavy for old accounts. |
| 10,000 | Single-process ceilings dominate: bcrypt threadpool on login, embedded workers sharing the web process, socket fan-out single-node (AUDIT-024), ILIKE scans quadratic-feeling. By here the fixes are already built: clamp+timeouts+FTS+key-unification, then (and only then) adapter+worker split. |

Cross-cutting: caching is effective where applied (feeds, detail, profiles); the gaps are invalidation correctness (AUDIT-013/026), not strategy.

---

# PART 12 — ARCHITECTURE REVIEW

**Current design:** strict routes→controllers→services→repositories layering; single composition roots (`repositories/index.ts`); shared utils; typed error channel; Zod at boundaries generating OpenAPI.

**Verdict: NO CHANGE NEEDED to the fundamental architecture.** It is the right shape, dependencies point inward, and no circular imports were found.

Targeted corrections (each justified above): consolidate the dual feed implementations (AUDIT-025); stop services reaching past repositories into `prisma` (`community.service.ts:220,225,250,290,352`, `post.service.ts:208,234`, `cron.worker.ts` — the latter documents its reason and is acceptable); extract the triplicated `isModOrAdmin` (AUDIT-037); centralize enqueue policy (AUDIT-008). Everything else — no DI framework, no CQRS, no policy engine, no abstraction layers — is correctly absent.

---

# PART 13 — WHAT SHOULD WE IMPLEMENT?

### MUST FIX (before calling this deployable/demoable)
1. AUDIT-001 ranking activation (+cast fix) — Low difficulty
2. AUDIT-002 recommendation `optionalAuth` — Trivial
3. AUDIT-003 migrate-on-boot entrypoint (+ AUDIT-040 seed) — Low
4. AUDIT-004 validated moderation bodies / author-unlock prevention — Low
5. AUDIT-005 last-moderator leave guard — Trivial
6. AUDIT-014 clamp feed limit — Trivial
7. AUDIT-012 verify limiter outage mode + trust proxy + exempt health — Low
8. AUDIT-022 timeouts/pool config — Trivial
9. AUDIT-007 admin role-grant + bootstrap — Medium

### SHOULD FIX
10. AUDIT-008 centralized fire-and-forget enqueue + jobId dedupe
11. AUDIT-009 truthful email failures
12. AUDIT-010 fail-closed denylist
13. AUDIT-011 lockout reset-on-expiry + reorder check
14. AUDIT-013 evict `post:<id>` on vote/comment
15. AUDIT-015 deletedAt filters on profile/community lists
16. AUDIT-018 Prisma error mapping in global handler
17. AUDIT-017 comment read: public, paginated, thread-preserving
18. AUDIT-019 invite membership check
19. AUDIT-020 slug normalizer
20. AUDIT-021 shared username regex
21. AUDIT-023 basic-auth /metrics + register rankingQueue
22. AUDIT-038 typecheck tests in CI

### NICE TO HAVE
23. AUDIT-006 community soft delete (needs schema OK) or confirmation-token minimum
24. AUDIT-016 tsvector search
25. AUDIT-025 feed consolidation · 26. AUDIT-026 key unification · 27. AUDIT-027 tiebreaker · 28. AUDIT-028/029 vote/save races · 30. AUDIT-031 saved-items reads · 32. AUDIT-032 NEW_FOLLOWER · 33. AUDIT-033 notification count/pagination · 34. AUDIT-034 report triage · 35. AUDIT-035 true atomic increment · 36. AUDIT-036 mod-race fixes · 39. AUDIT-039 observability trio · 41. AUDIT-041 cursor validation · 42. AUDIT-042 dead-code sweep

### DO NOT IMPLEMENT (would be over-engineering)
Microservices/Kubernetes/Kafka/RabbitMQ · Elasticsearch/OpenSearch · read replicas · distributed locks/leader election · separate worker process (premature) · transactional outbox (tiers 1-2 above suffice) · generic idempotency-key middleware · stampede/single-flight machinery · OpenTelemetry/tracing backend · log aggregation stack · Web Push/APNs/FCM · DM/chat/typing/receipts/presence · feature-flag platform · API version-routing framework · policy engines (Casbin/CASL) · GDPR erasure/export suites. Each solves a problem this single-instance portfolio-grade monolith does not have.

---

# PART 16 — FINAL REPORT (condensed)

## 1. Overall System Health
**Good bones, seven broken windows.** The architecture, test culture, and much of the security thinking are genuinely strong. But the flagship features (ranking, recommendations, platform moderation, containerized deploy) are dead or dangerous on a fresh clone, and several reliability contracts (Redis outage, lockout, cache freshness) fail in the user's face.

## 2. Critical Problems
AUDIT-001 (ranking dead+broken SQL) · 002 (anonymous rec crash) · 003 (no migrate-on-boot) · 004 (author unlocks moderated posts) · 005 (last-mod leaves) · 006 (irreversible cascade) · 007 (no role grant → 4 dead endpoints).

## 3. High Priority
008–024: Redis-coupled comment creation · false-positive email success · fail-open denylist · lockout loop · limiter fail-mode/trust proxy · stale post cache · unbounded feed limit · soft-delete leaks · seq-scan search · comment-read defects · unmapped Prisma errors · open invites · slugs · username charset · missing timeouts · unusable /metrics · socket single-process constraint.

## 4. Medium Priority
025–042 (dual feeds, cache-key strategy, cursor totality, vote/save races, saved-items reads, NEW_FOLLOWER, notification pagination, report void, atomic increment, mod races, role composition, test typechecking, observability gaps, seed script, ZSET cursor, dead code).

## 5. Low Priority
AUDIT-043 group (status-code cosmetics, NODE_ENV reads, 204 quirk, heavy existence checks, key hygiene, rosters, LINK type, typo).

## 6. Security Improvements
Fix 004/007/010/011/012/019/020/021. Leave as-is: no-CSRF-token posture, 15-min access-token bound, no sanitizer dependency, env-based secrets.

## 7. Database Improvements
Optional `Community.deletedAt` (with your approval) · optional tsvector/GIN · skip native-uuid migration · add statement/connection timeouts · tiebreaker in orderBys · bounds on collection queries.

## 8. Performance Improvements
Clamp limit · unify per-viewer keys · FTS · pool/timeouts · exact-key invalidation · notification pagination. Nothing else until measured.

## 9. Testing Improvements
Typecheck tests in CI · targeted regression tests for each MUST FIX · coverage gate on services only · delete orphaned files.

## 10. Deployment Improvements
Entrypoint migrate-deploy · seed · smoke-run image in CI · document single-instance constraint + adapter/sticky precondition.

## 11. Architecture Improvements
Feed consolidation · enqueue choke-point policy · one isModOrAdmin · services stop bypassing repositories · written ADRs (worker topology, socket scaling, version policy). No structural refactor.

## 12. Recommended Features
Saved-items listing · working NEW_FOLLOWER · unread-count endpoint · report triage minimum. That is the honest complete list — the project needs completion of started features far more than new ones.

## 13. Things We Should NOT Add
See DO NOT IMPLEMENT above — 16 named technologies/patterns, each with a reason.

## 14. Implementation Order
1. **Trivial unlockers** (AUDIT-002, 005, 014, 021, 022, 027) — one afternoon, kills five findings.
2. **Ranking activation** (AUDIT-001) + dashboard/metrics registration (023).
3. **Deployability** (AUDIT-003 + 040) + role bootstrap (007).
4. **Security correctness** (004, 011, 012 verification, 019, 020).
5. **Reliability contracts** (008, 009, 010, 013, 015, 018, 017), then mediums by taste.

## 15. Final Recommendation
**Needs important work — but narrowly scoped, and close.** Not ready to deploy (criticals 001–007). Not "almost ready" either until the MUST FIX list lands. The encouraging part: nine of the eleven must-fixes are hours, not weeks, because the architecture underneath is sound and tested. Fix the must-fixes and this converts from "project that happens to work" to "system that demonstrably works" without adding a single new technology.

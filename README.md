# Forum Backend

A production-oriented REST + WebSocket API for a Reddit-style discussion platform: communities, threaded comments, weighted voting, ranked feeds, background jobs, and real-time notifications.

Built with TypeScript in strict mode on Node.js 24 (native ESM), Express 5, Prisma 7 over PostgreSQL, Redis, and BullMQ. It is layered along Clean Architecture lines, covered by three distinct test suites, and validated end-to-end by CI against real containerized datastores rather than mocks.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Features](#2-features)
3. [Architecture](#3-architecture)
4. [Technology Stack](#4-technology-stack)
5. [Folder Structure](#5-folder-structure)
6. [Installation](#6-installation)
7. [Local Development](#7-local-development)
8. [Docker](#8-docker)
9. [Environment Variables](#9-environment-variables)
10. [Testing](#10-testing)
11. [CI/CD](#11-cicd)
12. [Available Scripts](#12-available-scripts)
13. [API Documentation](#13-api-documentation)
14. [Deployment](#14-deployment)
15. [Troubleshooting](#15-troubleshooting)
16. [Future Improvements](#16-future-improvements)

---

## 1. Project Overview

This service is the complete backend for a community-driven forum. Users register and verify by email, create and join communities, publish posts, reply in threads, and vote content up or down. Votes feed a ranking pipeline that maintains *hot*, *top*, *new*, and *controversial* orderings, and a recommendation layer suggests communities and posts based on a user's activity graph.

Three concerns drove the design:

**Correctness under concurrency.** Voting, membership, and moderation all mutate shared counters. Those operations run inside Prisma transactions with unique constraints backing them (a user can hold exactly one vote per post, enforced by a `@@unique([userId, postId])` index rather than by application-level checking), so a race produces a constraint violation rather than a corrupted score.

**Work that does not belong in the request path.** Sending email, fanning out notifications, and recomputing ranking scores are queued to BullMQ and processed by dedicated workers. An HTTP handler enqueues and returns; it never waits on SMTP.

**Operability.** Every request carries a trace ID that flows into structured Pino logs and into error responses, so a user-reported failure can be located in the logs by ID. Prometheus metrics expose request rate, latency histograms, and queue depth. A deep readiness probe verifies Postgres, Redis, BullMQ, and Socket.IO independently instead of returning a bare `200 OK`.

The project is deliberately built to production conventions. Graceful shutdown, health probes, non-root containers, secret hygiene, rate limiting, and a real CI pipeline conventions.

---

## 2. Features

**Authentication and accounts.** Email-and-password registration with bcrypt hashing, email verification tokens, login issuing a short-lived access token (15 minutes) alongside a refresh token delivered as an `httpOnly` cookie (7 days), token rotation on refresh, logout, password change, forgot-password and reset-password flows, profile read and update, and account deletion implemented as a soft delete so authored content and referential integrity survive.

The refresh secret is combined with the user's current password hash at signing time. Changing a password therefore invalidates every outstanding refresh token for that user without needing a revocation table.

**Communities.** Creation with slug addressing, browsing and search, membership join and leave, invitations, moderator appointment and removal, rule and metadata editing, and avatar/banner updates. Authorization is role-based: a `SystemRole` on the user and a `MembershipRole` per community.

**Posts and comments.** Post creation across multiple `PostType` variants, editing, deletion, saving and unsaving, and moderation actions (lock, hide, report). Comments are threaded via a self-referential parent relation and support saving, reporting, editing, and deletion.

**Voting and ranking.** A single `POST /api/v1/votes` endpoint expresses all three intents — casting, switching, and removing — and reports back which occurred (`CREATED`, `CHANGED`, or `REMOVED`) rather than making the client infer it. Scores are computed by two documented algorithms in `src/utils/ranking.math.ts`: a logarithmic hot score with linear time decay (a post needs roughly ten times the votes to hold rank every 12.5 hours), and a controversy score that maximizes when a high-volume post is split near evenly.

**Feed and recommendations.** A ranked, filterable, cacheable feed, plus community and post recommendations derived from the follow and membership graph. Feed responses are cached in Redis and invalidated by pattern deletion when the underlying content changes.

**Real-time.** Socket.IO with JWT handshake authentication. Clients join per-post rooms to receive live comment and vote activity, and each authenticated user is placed in a private room for notification delivery.

**Background processing.** Four BullMQ queues — email, notification, cron, and ranking — each with a dedicated worker. Recurring ranking recomputation is registered as a repeatable job. A Bull Board dashboard is mounted at `/admin/queues` behind HTTP basic auth.

**Media.** Cloudinary signed direct uploads. The server issues a short-lived signature for a constrained folder set (`avatars`, `banners`, `posts`); the file itself never transits this API, and the Cloudinary API secret is used only to sign and is never returned in a response.

**Cross-cutting.** Helmet security headers, an explicit CORS allowlist shared by Express and Socket.IO, Redis-backed rate limiting (100 requests per 10 minutes globally, tightened to 10 per 15 minutes on authentication endpoints), Zod request validation, OpenAPI documentation generated from those same Zod schemas, Prometheus metrics, and structured logging.

---

## 3. Architecture

The application is layered, and dependencies point inward only:

```
HTTP request
    │
    ▼
 routes/          URL shape, HTTP verb, middleware composition
    │
    ▼
 middlewares/     auth, validation, rate limiting, tracing, metrics
    │
    ▼
 controllers/     parse input, call one service, shape the response
    │
    ▼
 services/        business rules, transactions, cache policy, queueing
    │
    ▼
 repositories/    all Prisma access, one class per aggregate
    │
    ▼
 PostgreSQL
```

**Routes** declare structure and nothing else. A route file maps a path to a middleware chain and a controller; it contains no logic.

**Controllers** are thin by rule. Each is wrapped in `asyncHandler`, which forwards rejected promises to the global error handler — so no controller contains a `try/catch`. A controller extracts and validates input, calls exactly one service function, and serializes the result.

**Services** hold the business rules and are exported as plain functions rather than classes, because they are stateless and function exports give better tree-shaking and simpler test seams than instantiating a class for behavior that has no state.

**Repositories** are classes with a `PrismaClient` injected through the constructor. This is the one place classes earn their keep: the injected client is what allows a repository to participate in a caller's transaction, and it is what makes unit tests able to supply a typed test double without module mocking.

**Error handling** is a three-part contract used everywhere. `AppError(message, statusCode)` expresses expected failures; `asyncHandler` catches them; `globalErrorHandler` translates them — a `ZodError` becomes `400` with field detail, an `AppError` becomes its own status, anything else becomes `500` with the internal detail logged but not exposed. Every error response carries its `traceId`.

**Validation** lives in `src/validators/` as Zod schemas, and those exact schemas are registered with `@asteasolutions/zod-to-openapi` to generate the API documentation. The docs cannot drift from the validation rules, because they are the same objects.

**Type safety** is strict. `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `noUncheckedSideEffectImports`. The `any` type does not appear in `src/`.

---

## 4. Technology Stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 24.18.0, native ESM (`"type": "module"`) | Pinned via `.nvmrc`; ESM throughout, no transpiled CommonJS interop |
| Language | TypeScript 6, strict | `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` on |
| Framework | Express 5 | Native async error propagation |
| ORM | Prisma 7 with `@prisma/adapter-pg` | Typed queries and migrations over a `pg` pool |
| Database | PostgreSQL | Relational integrity for the vote/membership/follow graph |
| Cache & rate limiting | Redis via `ioredis` 5 | Feed caching, `rate-limit-redis` store |
| Queues | BullMQ 5 with `@bull-board/express` | Email, notification, cron, and ranking workers |
| Real-time | Socket.IO 4 | JWT-authenticated handshake, room-based delivery |
| Validation & docs | Zod 4 + `@asteasolutions/zod-to-openapi` | One schema serves both roles |
| Auth | `jsonwebtoken`, `bcrypt` | Access/refresh split, hashed credentials |
| Logging | Pino 10 (+ `pino-pretty` in development) | Structured JSON, trace-correlated |
| Metrics | `prom-client` | Request counters, latency histograms, queue gauges |
| Media | Cloudinary | Signed direct upload, no file passes through the API |
| Email | Nodemailer | SMTP delivery from the email worker |
| Security | `helmet`, `cors`, `express-rate-limit`, `cookie-parser` | Headers, origin allowlist, throttling |
| Testing | Jest 30 + `@swc/jest`, Supertest 7, Testcontainers 12 | Three suites; real Postgres and Redis for two of them |
| Tooling | Biome 2.5, Husky, lint-staged, tsx, `dotenv-cli` | Lint/format on commit, fast dev reload |

---

## 5. Folder Structure

```
forum-backend/
├── .github/workflows/ci.yml     Four-job CI pipeline
├── prisma/schema.prisma         Data model: 13 models, 5 enums
├── src/
│   ├── config/                  Env resolution and validation (fail-fast)
│   ├── controllers/             Thin HTTP adapters, all asyncHandler-wrapped
│   ├── services/                Business rules, transactions, cache, queueing
│   ├── repositories/            Prisma access; classes with injected client
│   ├── routes/                  10 API routers + health and metrics
│   ├── middlewares/             auth, optionalAuth, role, rate limit, trace,
│   │                            logging, metrics, errorHandler, asyncHandler,
│   │                            socket, queueAuth
│   ├── validators/              Zod schemas (also the OpenAPI source)
│   ├── queues/                  Queue definitions + tracked connection registry
│   ├── workers/                 email, notification, cron, ranking processors
│   ├── socket/                  Socket.IO server, typed events, room handlers
│   ├── errors/                  AppError
│   ├── docs/                    OpenAPI document assembly
│   ├── utils/                   prisma, redis, logger, mailer, metrics,
│   │                            ranking.math
│   ├── app.ts                   Express assembly and middleware order
│   └── main.ts                  Bootstrap, listen, graceful shutdown
├── tests/
│   ├── unit/services/           9 suites, fully isolated, no I/O
│   ├── integration/             8 suites against real Postgres + Redis
│   ├── e2e/                     18 suites, full HTTP through the real app
│   ├── helpers/                 lifecycle, app, auth, database, containers
│   ├── global-setup.ts          Boots the container cluster once per run
│   ├── global-teardown.ts       Stops it once per run
│   ├── container-state.ts       Setup→worker handoff (see Testing)
│   └── setup-env.ts             Test environment defaults
├── compose.yaml                 Local stack: api + postgres + redis
├── Dockerfile                   Three-stage build, non-root runtime
└── jest.{config,integration.config,e2e.config}.cjs
```

---

## 6. Installation

**Prerequisites**

- Node.js 24.18.0 (`nvm use` reads `.nvmrc`)
- Docker Desktop or a Docker Engine — required for the integration and E2E suites, which start real containers
- A PostgreSQL 16+ instance and a Redis 7+ instance for local runs, or use `compose.yaml` to get both

```bash
git clone https://github.com/Afaks-11/forum-backend.git
cd forum-backend

nvm use
npm ci

cp .env.example .env
# Fill in the values — see Environment Variables below.

npx prisma generate
npx prisma db push
```

`npm ci` rather than `npm install`: it installs exactly the lockfile, which is what CI and the Docker build use.

The schema is currently applied with `db push` rather than through a migration history — see [Deployment](#14-deployment) for why that needs to change before this ships.

---

## 7. Local Development

```bash
npm run dev
```

`tsx watch` runs `src/main.ts` directly with reload on change — no build step in the loop. On boot the server initializes Socket.IO, registers repeatable jobs, and listens on `PORT` (default `3000`).

Useful URLs once it is up:

| URL | Purpose |
|---|---|
| `http://localhost:3000/api-docs` | Swagger UI |
| `http://localhost:3000/health` | Bootstrap confirmation and uptime |
| `http://localhost:3000/health/live` | Liveness — event loop responsive |
| `http://localhost:3000/health/ready` | Readiness — Postgres, Redis, BullMQ, Socket.IO |
| `http://localhost:3000/metrics` | Prometheus scrape (admin auth required) |
| `http://localhost:3000/admin/queues` | Bull Board (basic auth) |

Code quality is enforced by Biome and runs automatically on staged files through Husky and lint-staged:

```bash
npm run lint        # check
npm run lint:fix    # check and write
npm run format      # format only
npm run build       # tsc — type check and emit to dist/
```

If you only need the datastores locally and want to run the API on the host:

```bash
docker compose up -d forum-postgres forum-redis
```

---

## 8. Docker

The `Dockerfile` is a three-stage build:

1. **dependencies** — `npm ci` against the lockfile alone, so this layer caches until dependencies actually change.
2. **builder** — generates the Prisma client (against a throwaway `DATABASE_URL`, since generation only needs the schema) and compiles TypeScript.
3. **production** — installs production dependencies with `--omit=dev --ignore-scripts`, copies only `dist/` and the generated client, drops to the non-root `node` user, and declares a `HEALTHCHECK` that polls `/health/ready`.

Running as `node` rather than `root` matters: in a container, `root` is uid 0 on the host too, so a container escape starts from a far worse position than it needs to. Runtime files are copied with `--chown=node:node` so the process can read its own code but not overwrite it.

To run the whole stack:

```bash
cp .env.example .env.docker
docker compose up --build
```

`compose.yaml` defines the API plus PostgreSQL 17 and Redis 7. Three details are deliberate:

- Both datastore ports are published to `127.0.0.1` only. They are exposed for local tooling, not for the network.
- Every service declares a healthcheck, and the API declares `depends_on: condition: service_healthy`. This is not cosmetic — `src/config/env.config.ts` resolves eagerly and both the Redis client and the Prisma pool are constructed at *import* time, so the process connects before it serves a single request. Waiting for "started" instead of "healthy" produces a boot-time connection failure.
- `DATABASE_URL` and `REDIS_URL` are overridden with Compose service names, which is what makes `cp .env.example .env.docker` a valid bootstrap despite that file naming `localhost`.

A `docker-compose.yml` also exists but is a deprecated shim that `include`s `compose.yaml`. Docker resolves `compose.yaml` first, so `compose.yaml` is the file to edit.

---

## 9. Environment Variables

Every variable below is **required**. `src/config/env.config.ts` resolves them at startup through `getEnvOrThrow` and throws on any that are missing, so a misconfigured deployment fails immediately and loudly rather than at the first request that happens to need the missing value. `.env.example` is the authoritative template.

| Variable | Description |
|---|---|
| `NODE_ENV` | `development`, `production`, or `test` |
| `PORT` | HTTP listen port (default `3000`) |
| `CORS_ORIGINS` | Comma-separated allowlist, shared by Express and Socket.IO |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_ACCESS_TOKEN_SECRET` | Signs 15-minute access tokens |
| `JWT_REFRESH_TOKEN_SECRET` | Signs 7-day refresh tokens; combined with the user's password hash, so a password change revokes them |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account |
| `CLOUDINARY_API_KEY` | Cloudinary key |
| `CLOUDINARY_API_SECRET` | Used only to sign uploads; never returned in a response |
| `BULL_BOARD_USERNAME` | Basic auth for `/admin/queues` |
| `BULL_BOARD_PASSWORD` | Basic auth for `/admin/queues` |
| `SMTP_USER` | SMTP account |
| `SMTP_PASS` | SMTP password or app password |
| `SMTP_FROM` | From header, e.g. `Forum Platform <no-reply@example.com>` |

Generate the JWT secrets with real entropy and make them different from each other:

```bash
openssl rand -base64 48
```

`.env`, `.env.test`, and `.env.docker` are git-ignored. `.env.example` contains placeholders only.

---

## 10. Testing

Three suites, three configs, three different trade-offs between speed and fidelity.

### Unit — `npm run test:unit`

Nine suites, 140 tests, covering the service layer in `tests/unit/services/`. No database, no Redis, no HTTP. Repositories are supplied as typed test doubles through constructor injection, which is precisely why repositories are the one layer built as injectable classes. These run in a few seconds and are the suite you keep open while working.

### Integration — `npm run test:integration`

Eight suites, 91 tests, exercising routes through Supertest against a **real** PostgreSQL and a **real** Redis started by Testcontainers. No datastore is mocked. These catch what unit tests structurally cannot: Prisma query correctness, transaction and constraint behavior, cache invalidation, and middleware ordering.

### End-to-End — `npm run test:e2e`

Eighteen suites, 116 tests, driving complete user journeys over HTTP against the fully assembled application — registration through verification, login, community creation, posting, voting, notification delivery, password recovery, and account management. Coverage spans the happy path plus authorization (can another user do this?), validation (malformed UUIDs, bad enums, length bounds), and security properties asserted directly, such as: a password hash is never present in a profile response, the Cloudinary API secret never appears in a signature response, and forgot-password returns an identical response for known and unknown emails so it cannot be used to enumerate accounts.

### Run everything

```bash
npm run test:all      # unit → integration → e2e, sequentially
npm run test:coverage # unit suite with a coverage report
```

Docker must be running for the integration and E2E suites.

### How the container lifecycle works

This is the part worth understanding, because it is where this setup differs from the common approach.

A single PostgreSQL and Redis pair is started **once per run** in `tests/global-setup.ts` and stopped once in `tests/global-teardown.ts`. The schema is pushed once via `prisma db push`.

Jest runs `globalSetup` in the main process while test files execute in worker processes, so the setup phase cannot simply assign `process.env` for the workers to read. The container URLs are therefore handed over through a small temp file (`tests/container-state.ts`), which `tests/setup-env.ts` reads before any application module is imported.

Isolation between tests comes from truncation, not from restarting containers: `resetDatastores()` truncates every table and calls `flushdb()` in a `beforeEach`. Flushing Redis also clears the `rl:` and `rl:auth:` rate-limiter keys, which is what stops a long suite from tripping its own 10-requests-per-15-minutes auth limiter and failing with unexplained `429`s.

Both the integration and E2E setups are three-line delegators over one shared module, `tests/helpers/lifecycle.ts`. There is a single Prisma client and a single connection pool per worker.

Neither suite uses `--forceExit`. That flag hides leaked handles; without it, a connection the application forgets to close shows up immediately as Jest's "did not exit one second after test run completed" warning. Keeping that signal is deliberate.

---

## 11. CI/CD

`.github/workflows/ci.yml` runs on pushes and pull requests to `main` and `dev`, with `concurrency` cancelling superseded runs and `permissions: contents: read` as the default token scope.

```
quality-check ──┬── integration-tests ──┐
                └── e2e-tests ──────────┴── docker-verification
```

**quality-check** — installs from the lockfile, validates the Prisma schema, generates the client, runs `biome ci` (which fails on formatting drift rather than rewriting it), type-checks via `npm run build`, runs the unit suite with coverage, and uploads the coverage report as an artifact.

**integration-tests** and **e2e-tests** — run in parallel after quality-check, each verifying Docker availability first, then running its suite against Testcontainers.

**docker-verification** — validates the Compose configuration, then builds the image through Buildx with GitHub Actions layer caching (`cache-from`/`cache-to: type=gha`), and publishes a job summary.

The two test jobs are parallel because they share no state — each starts its own container cluster. `docker-verification` gates on both, so a green image build always implies green tests.

---

## 12. Available Scripts

| Script | What it does |
|---|---|
| `npm run dev` | `tsx watch src/main.ts` — reload on change |
| `npm run build` | `tsc` — type check and emit to `dist/` |
| `npm start` | `node dist/main.js` — run the build |
| `npm run lint` | Biome check |
| `npm run lint:fix` | Biome check with writes |
| `npm run format` | Biome format |
| `npm run test:unit` | Unit suite |
| `npm run test:integration` | Integration suite (Docker required) |
| `npm run test:integration:watch` | Integration suite in watch mode |
| `npm run test:e2e` | E2E suite (Docker required) |
| `npm run test:all` | All three, in order |
| `npm run test:coverage` | Unit suite with coverage |
| `npm run test:watch` | Unit suite in watch mode |
| `npm run test:changed` | Only suites affected by changed files |
| `npm run test:ci` | Unit suite, CI reporter, 2 workers, coverage |
| `npm run db:test:push` | Push the schema to the `.env.test` database |

---

## 13. API Documentation

Swagger UI is served at `/api-docs`. The OpenAPI document is generated from the same Zod schemas used for runtime request validation, so the documentation and the enforcement cannot disagree.

All application routes are mounted under `/api/v1`.

| Base path | Responsibility |
|---|---|
| `/api/v1/auth` | Register, login, refresh, logout, verify email, resend verification, forgot/reset password, change password, profile read/update/delete |
| `/api/v1/communities` | Browse, search, read, create, update, join, leave, invite, moderators, rules, avatar, banner, members, community posts |
| `/api/v1/posts` | List, search, read, create, update, delete, save/unsave, vote data, lock, hide, report |
| `/api/v1/comments` | Read by post, create, update, delete, save, report |
| `/api/v1/votes` | Cast, switch, or remove a vote |
| `/api/v1/users` | Search, public profile, user posts and comments, follow/unfollow, block/unblock |
| `/api/v1/notifications` | List, unread, mark one read, mark all read, delete |
| `/api/v1/recommendations` | Suggested communities and posts |
| `/api/v1/feed` | Ranked, filterable, cached feed |
| `/api/v1/upload` | Cloudinary signature for direct client upload |

Operational endpoints sit outside the versioned prefix: `/health`, `/health/live`, `/health/ready`, `/metrics` (admin only), and `/admin/queues`.

**Authentication.** Send the access token as `Authorization: Bearer <token>`. The refresh token is set as an `httpOnly` cookie by login and consumed by `POST /api/v1/auth/refresh`; clients never read it from JavaScript.

**Errors.** Every failure returns a consistent envelope carrying its `traceId`, which is the same ID present in the structured log line for that request.

---

## 14. Deployment

The production artifact is the Docker image built from the `production` stage. It runs as a non-root user, contains no development dependencies and no source, and declares its own healthcheck.

**Prerequisites.** Managed PostgreSQL and managed Redis with persistence enabled (BullMQ job state lives in Redis; losing it loses queued work). All fifteen environment variables supplied through the platform's secret store, never baked into the image.

**Schema changes — the one genuine gap.** This project has no `prisma/migrations` directory; the schema is applied with `prisma db push`, which diffs the live database against the schema and reshapes it in place. That is fine for development and is exactly right for the test suites, which push into a throwaway container. It is not safe for production: `db push` has no version history, no review artifact, no forward/backward ordering, and will silently drop a column to make the database match. Before a first real deployment, run `npx prisma migrate dev --name init` to capture the current schema as a migration, commit the result, and switch the release step to `npx prisma migrate deploy` — which applies committed migrations only and never generates or prompts, making it safe to run unattended.

**Probes.** Point liveness at `/health/live` (event loop responsive) and readiness at `/health/ready` (Postgres, Redis, BullMQ, and Socket.IO each verified, reported per-service, and returning a non-`UP` status if any dependency is down). Using the deep check for readiness means an instance that has lost Redis is removed from the load balancer instead of quietly failing requests.

**Shutdown.** On `SIGTERM` or `SIGINT` the process stops accepting connections, then closes queues, then Redis, then Prisma, in that order, with a 10-second force-exit backstop. Ordering matters: releasing Redis before draining BullMQ leaves workers writing to a closed socket. Give the orchestrator a termination grace period of at least 15 seconds.

**Scaling.** The HTTP layer is stateless and scales horizontally. Two caveats: Socket.IO needs its Redis adapter enabled before running more than one instance, or a client connected to instance A will not receive an event emitted from instance B; and BullMQ workers can be scaled independently of the API, which is the more useful axis once ranking recomputation becomes the dominant cost.

**Observability.** Scrape `/metrics` for request rate, latency histograms, and queue depth. Ship the Pino JSON to a log aggregator and index on `traceId`.

---

## 15. Troubleshooting

**`ECONNREFUSED 127.0.0.1:<random port>` or `AggregateError` during tests.** This was a real defect in this repository and is fixed; if it reappears, the cause is a Redis client created at import time that outlived the container it was bound to. Confirm `tests/global-setup.ts` and `tests/global-teardown.ts` are wired into both Jest configs (one cluster per run, not one per file), and that every connection handed to a BullMQ queue or worker comes from `createQueueConnection()` in `src/queues/connection.ts` so it is tracked and closable. Do not "solve" this by silencing the Redis error logger; the log is the symptom, not the fault.

**Jest exits with "did not exit one second after test run completed."** Something is holding an open handle. Because `--forceExit` is intentionally absent, this warning is doing its job. Check that any new client is closed in `teardownTestLifecycle()`.

**`Module @swc/jest in the transform option was not found`, or a `setupFiles` module that visibly exists reports as missing.** `node_modules` was installed on a different platform than the one running Jest (commonly: installed on Windows, executed in a Linux container). Native and platform-gated packages will not resolve. Run `npm ci` on the platform you intend to test on.

**Startup throws about a missing environment variable.** Working as designed — `getEnvOrThrow` fails fast. Compare `.env` against `.env.example`; all fifteen are required.

**Testcontainers cannot start.** Docker is not running or the socket is not reachable. `docker info` must succeed. On Windows, Docker Desktop must be running before `npm run test:integration`.

**`429 Too Many Requests` while testing by hand.** The auth limiter allows 10 requests per 15 minutes per IP. Flush Redis or wait out the window.

**Prisma client type errors after a schema change.** Run `npx prisma generate`. The client is generated into `src/generated/prisma` and is not regenerated automatically on schema edits.

**Compose changes appear to have no effect.** Edit `compose.yaml`, not `docker-compose.yml`. Docker resolves the former first; the latter is a deprecated shim that includes it.

---

## 16. Future Improvements

**Refresh token rotation with reuse detection.** Refresh tokens are currently stateless and revoked in bulk by a password change. Persisting a token family and invalidating the whole family when an already-used token is replayed would detect theft rather than merely limiting its window.

**Socket.IO Redis adapter.** Required before the API runs on more than one instance. The Redis infrastructure is already in place; this is a wiring change, not new infrastructure.

**Outbox pattern for queue writes.** A job enqueued inside a database transaction can currently be published even if that transaction later rolls back. Writing intent to an outbox table and relaying it after commit closes that window.

**Cursor-based pagination on the feed.** Offset pagination degrades on deep pages and can skip or duplicate rows when content is inserted mid-scroll. Cursor pagination fixes both and suits an infinite-scroll client better.

**Full-text search.** Search is currently pattern matching. A PostgreSQL `tsvector` column with a GIN index would deliver ranked relevance without adding a search service.

**Contract testing against the OpenAPI document.** The document is generated from the Zod schemas, so responses could be asserted against it in CI — closing the remaining gap where a response *shape* drifts from the documented one.

**Load testing the ranking pipeline.** Ranking recomputation is the workload most likely to become the bottleneck. A k6 profile would establish where.

**Structured audit log for moderation.** Lock, hide, report, and moderator changes are consequential and currently leave no first-class trail.

---

## License

ISC. Author: Hamman Wadzani Afakirya.

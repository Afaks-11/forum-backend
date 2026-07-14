## 2026-06-29: MVP Requirements & Soft Delete Strategy
* **Context:** Need to define scope and data lifecycle before designing the DB.
* **Decision:** MVP will strictly focus on Auth, Communities, Posts, Comments, and Votes. We will implement "Soft Deletes" for all user-generated content.
* **Consequences:** Soft deleting means our database queries will need to constantly filter out `deleted_at IS NOT NULL` records, but it ensures moderation audit trails and prevents orphaned child comments when a parent post is deleted.


## 2026-06-29: Async Processing & Real-Time Architecture
* **Context:** Need to handle slow external tasks (emails) and real-time updates without blocking the main HTTP request thread.
* **Decision:** Implement the Asynchronous Worker Pattern using BullMQ backed by Redis for background jobs.
* **Consequences:** Provides fast API response times and fault tolerance (failed emails can be retried automatically by BullMQ). Requires setting up separate worker processes and managing Redis memory.
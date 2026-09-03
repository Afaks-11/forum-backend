# ADR 001: Single-Instance Realtime Topology

**Status:** Accepted

**Context:** Socket.IO rooms and the `getIO()` singleton live in one Node.js
process. BullMQ workers are embedded in that same process, so persisted
notifications can be emitted to connected clients without a cross-process
adapter.

**Decision:** Production runs exactly one application instance. PostgreSQL is
the source of truth for notifications, so a missed socket event remains
available through the notification API.

**Scaling trigger:** Before increasing the application replica count, add the
Socket.IO Redis adapter using dedicated publisher/subscriber connections and
configure sticky sessions at the ingress. Split workers only after that fan-out
path is in place. Until those two conditions are met, multiple replicas are not
a supported topology.

**Consequence:** The current deployment stays operationally small and avoids
two unused Redis connections. Horizontal scaling is explicitly blocked rather
than silently delivering realtime events only to clients on the emitting node.

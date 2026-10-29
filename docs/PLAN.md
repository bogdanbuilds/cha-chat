# Group Chat App Implementation Plan

## Scope

Build a small Node.js + Express group chat service backed by SQLite. Clients authenticate, join rooms, fetch ordered message history, and receive live updates over Server-Sent Events (SSE).

## File layout

- `src/server.js` — Express setup, middleware, routes, and startup.
- `src/db.js` — SQLite connection, schema initialization, and query helpers.
- `src/auth.js` — password hashing, session/token creation, and auth middleware.
- `src/routes/auth.js` — registration, login, logout, and current-user endpoints.
- `src/routes/rooms.js` — room listing/creation and membership management.
- `src/routes/messages.js` — message history/posting and room SSE endpoint.
- `src/sse.js` — per-room client registry, event formatting, and fan-out.
- `migrations/001_initial.sql` — initial schema and indexes.
- `package.json`, `.env.example`, `README.md` — dependencies, configuration, and run instructions.

## Data model

- `users`: `id`, unique `username`, `password_hash`, `created_at`.
- `rooms`: `id`, `name`, `created_by` (user ID), `created_at`.
- `memberships`: `room_id`, `user_id`, `joined_at`; composite primary key `(room_id, user_id)`.
- `messages`: `id`, `room_id`, `seq`, `user_id`, `body`, `created_at`; unique `(room_id, seq)`.

Enable SQLite foreign keys. Allocate `seq` transactionally per room using a room counter (a `next_seq` column on `rooms`); increment it and insert the message in the same transaction. This provides a stable, gap-detectable order within each room.

## API

- `POST /api/auth/register` — create account and authenticated session.
- `POST /api/auth/login` — verify credentials and issue session/token.
- `POST /api/auth/logout` — revoke current session.
- `GET /api/auth/me` — return current user.
- `GET /api/rooms` — list rooms the user belongs to.
- `POST /api/rooms` — create a room; creator becomes a member.
- `POST /api/rooms/:roomId/members` — add a member (initially creator/admin only).
- `GET /api/rooms/:roomId/messages?after=<seq>&limit=<n>` — return ascending messages after a room sequence, with a bounded page size.
- `POST /api/rooms/:roomId/messages` — validate membership and body, persist, then publish the created message.
- `GET /api/rooms/:roomId/events` — authenticated, membership-checked SSE stream.

## SSE delivery, ordering, and reconnect

Use one SSE connection per open room. On connection, validate the user is a room member, send `Content-Type: text/event-stream`, and register the client with that room's in-process subscriber set. Each persisted message is broadcast as a `message` event with its room sequence as the SSE `id` and a JSON payload. Publish only after the SQLite transaction commits; all live and replayed messages use the same ascending `seq` order.

For reconnect, read `Last-Event-ID` (or an `after` query parameter for the initial connection), then replay stored messages with `seq > cursor` before switching to live delivery. Avoid a replay/live race by registering the subscriber before querying replay, buffering arrivals during replay, then flushing buffered events in sequence order while discarding duplicates at or below the cursor. Heartbeats keep idle connections alive; clean up subscribers on close. Replaying from SQLite makes reconnect reliable across missed events and process restarts. SSE fan-out is process-local in the first version, so run a single app process until a shared event broker is introduced.

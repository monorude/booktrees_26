# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Phase 1 (foundation & auth) is implemented. Phases 2–5 are not started.

Planning artifacts, all still current:

- `specification.md` — the authoritative spec for a book-collection management app (蔵書管理アプリ). It is actively being revised by the user in small increments; always re-read it before starting implementation work rather than relying on a summary from a past session.
- `testdata.txt` — sample ISBNs plus raw openBD API JSON responses for those ISBNs, used as reference data when building the API-integration layer. Note the comment inside it: hyphens in scanned/typed ISBNs must be stripped before lookup (`9--7-8-4...` ≡ `9784...`).
- `IMG_7720.jpeg` — a visual reference (from 『シメジシミュレーション』第2巻, p56) for the "graph of connected books" concept behind the clustering/visualization screen; the tree motif itself is not required, only the graph-with-icons-and-edges layout.

## Commands

```bash
npm run dev                # wrangler dev on :8787 (local D1/R2 simulation, no Cloudflare account needed)
npm run typecheck          # tsc --noEmit — the only automated check that exists so far
npm run cf-typegen         # regenerate worker-configuration.d.ts; rerun after editing wrangler.jsonc
npm run db:migrate:local   # apply migrations/ to the local SQLite used by wrangler dev
npm run db:migrate:remote  # apply migrations/ to the real D1 database
npm run deploy             # wrangler deploy
```

There is no test framework yet. When adding one, `@cloudflare/vitest-pool-workers` is the standard choice for this stack.

## Code map

- `src/index.ts` — Worker entry point. Hono routes, all under `/api/*`.
- `src/auth.ts` — Cloudflare Access JWT verification, dev-mode fallback, `requireUser` middleware.
- `src/db.ts` — every D1 query lives here. Callers pass a `userId`.
- `src/types.ts` — `AppEnv` (generated `Env` + `.dev.vars` extras) and the Hono context type.
- `migrations/` — D1 schema. `0001_initial_schema.sql` creates users/statuses/genres/books.
- `public/` — the entire frontend: plain HTML/CSS/vanilla JS, served as static assets without invoking the Worker.

## Conventions

- **Write plentiful explanatory comments, in Japanese.** The spec asks for this explicitly (「私のようなバカでもわかるように、どのような処理を行なっているかに関するコメントアウトを多めに記述して欲しい」). This overrides the usual preference for sparse comments — explain what a block does and why, not just the non-obvious parts. Existing files set the expected density.
- **Every query that touches user data filters on `user_id`.** This is the whole mechanism behind "each user sees only their own data" — there is no other isolation layer.
- **Always bind SQL parameters with `.bind()`**, never string interpolation.
- **Render user-entered text with `textContent`, never `innerHTML`** — titles, memos, and genre names are free text and would otherwise be an XSS vector.

## What the app is

A web app for managing a personal book collection, distinct from existing tools in two ways:
1. It must also track 同人誌 (doujin/fan-made works), which have no ISBN.
2. It clusters books by content similarity and displays the collection as a graph.

## Architecture

- **Runtime/storage**: Cloudflare Workers + D1 (relational data) + R2 (cover images) + Cloudflare Access + Secrets Store.
- **Auth**: delegated entirely to Cloudflare Access with Google as the identity provider (Firebase was the other candidate in the spec; Access won because it needs no login code at all). Each authenticated user owns a fully private dataset — this is **not** a shared/multi-tenant library, each user edits only their own data.
- **Frontend**: plain HTML/CSS/vanilla JS, no framework. Server-side uses Hono purely as a router.
- **External data sources**: openBD API (fast, used first) and Google Books API (richer cover art) for general-book metadata lookup by ISBN/title.
- **Vectorization/clustering** (for the graph view): deferred/low-priority feature; if implemented, uses the Google Gemini API free tier on blurb text or, if absent, the user's memo field.

## Domain rules that are easy to miss

These are scattered across `specification.md` and are the kind of detail that's easy to violate if re-derived from scratch:

- **Two book types, two identity rules**: general books dedupe by ISBN when available; on title-only duplicate matches the user is warned but may still register it as a distinct record (e.g., two different translations sharing a title). Doujinshi dedupe **only** on exact match of (title, circle name) together — nothing else counts as a duplicate.
- **API call batching**: registrations must be queued and flushed at roughly 1 request/second to be polite to openBD/Google Books, not fired per-record immediately.
- **Offline multi-device conflict resolution**: modeled on git's "accept both changes" — the device that comes online first wins for overlapping edits; a second device's stale (non-new) fields are discarded on sync, not merged destructively.
- **Deletion vs. status change**: deleting a record is only for correcting mis-registrations. Selling/discarding a book is expressed by changing its 蔵書状態ステータス (a single status field per book), not by deleting the row.
- **User-managed lookup lists** (蔵書状態ステータス and ジャンル情報): both start with a non-deletable default value ("未設定"/"未設定"), both are otherwise user-extensible, and both fall back to "未設定" when a value in use is deleted.
- **Cover images**: fetched once at registration time and persisted permanently to R2 (DB stores only the R2 key) — not re-fetched on every graph/clustering regeneration. Users can also manually upload/replace a cover at any time (required for doujinshi, since neither API provides one). Missing covers fall back to a placeholder image. Upload constraints: jpg/png only, ~100KB max.
- **Backup format**: JSON (not CSV — CSV was considered and rejected). Import must reject records that violate field-length limits (title 200 chars, ISBN 10–13 chars, author 100 chars; doujinshi fields use the same limits) rather than silently truncating.
- **Barcode scanner input**: scanners typically emit the ISBN digits followed by Enter — the ISBN input path must treat a bare Enter keypress after digits as a submit trigger, and must strip hyphens from the scanned value.

## Implementation plan

Five phases, each a self-contained, demoable checkpoint. Order follows the dependency chain (infra → data you can already manage with existing apps → the two features that differentiate this app from existing ones → durability → the most experimental/deferrable feature last, per the spec's own "最悪後回しでもいい" note on clustering).

### Phase 1 — Foundation & auth — **done**
Built: Workers + Hono scaffold, D1 schema (users/statuses/genres/books), R2 binding reserved for covers, Access-based auth, per-user data isolation, and a minimal tabbed frontend that lists books (currently empty).

How auth works: Cloudflare Access sits in front and handles Google login, so this codebase has no login UI or session handling. It verifies the `Cf-Access-Jwt-Assertion` header (falling back to the `CF_Authorization` cookie) with `jose` against `https://<team-domain>/cdn-cgi/access/certs`, checking both `aud` and `iss`, and takes the email from the JWT payload. `.dev.vars`'s `DEV_EMAIL` stands in for a logged-in user locally, but **only while `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` are empty** — filling those in kills the dev path, so production fails closed (verified).

First login for an email auto-creates the `users` row plus that user's default 蔵書状態 (未設定/売却/破棄) and default ジャンル (未設定), in one D1 `batch()` transaction. The 未設定 rows carry `is_protected = 1` and must never be deletable. Concurrent first requests are handled by catching the `users.email` UNIQUE violation and re-reading the row.

The doujin duplicate rule is additionally enforced in the schema by a partial unique index on `(user_id, title, circle_name) WHERE book_type = 'doujin'` — a same-title/different-circle pair still inserts fine. Phase 3 should still check in app code first so the user gets a readable message rather than a constraint error.

Endpoints: `GET /api/me`, `GET /api/books?type=general|doujin`, `GET /api/statuses`, `GET /api/genres`. All require auth and scope by user.

Still needs the user's Cloudflare account (not doable from this repo alone): `wrangler d1 create bt-bookshelf-db` and pasting the returned id over `database_id` in `wrangler.jsonc`, `wrangler r2 bucket create bt-bookshelf-covers`, `npm run db:migrate:remote`, then creating the Access application (Google as identity provider, email allowlist for 身内) and filling `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD`.

### Phase 2 — General books, core CRUD
Scope: register by ISBN or title; openBD + Google Books lookup with the 1 req/sec batching queue; "not found in either API" fallback to manual entry; ISBN duplicate detection plus the title-duplicate confirm-and-allow flow; list view (no cover thumbnails per spec) with sort and title/author search; detail view; update/delete; memo field; 蔵書状態ステータス (single status per book, default list `[未設定, 売却, 破棄]`, user-extensible, 未設定 non-deletable fallback); barcode scanner input handling (Enter-triggered, hyphen-stripped ISBN).
Done when: a user can fully manage general books end-to-end via both barcode scanner and manual entry — this alone should feel like a working (if generic) book-tracking app.

### Phase 3 — Doujinshi support
Scope: doujinshi registration form (title, circle name, representative name, event name, publish date required; single-level user-extensible genre list with the same 未設定 default/non-deletable/fallback-on-delete behavior as statuses; manual cover image upload, jpg/png, ~100KB limit); title+circle-name exact-match duplicate detection; general/doujinshi tab split in the list UI; same field-length-limit validation as general books.
Done when: doujinshi have full CRUD parity with general books, in their own tab, with no ISBN dependency anywhere in the flow.

### Phase 4 — Cover caching, backup, and multi-device sync
Scope: write-through cover caching for general books (fetch once at registration, persist to R2, store only the R2 key in D1, never re-fetched on graph regeneration); manual cover replace for both book types; placeholder image for missing covers; JSON export/import backup with the field-length validation rejecting malformed records (not silently truncating); offline multi-device conflict resolution (first-online-wins, accept-both-changes-style merge for the rest).
Done when: data is portable (export/import round-trips cleanly) and correct across two devices editing the same account offline.

### Phase 5 — Clustering & graph visualization
Scope: the differentiator described in "視覚表示" — a dedicated screen that, on first visit, forces generation (cover-as-icon nodes, background color per cluster, edges between related books) and on later visits shows the last-generated result with a manual regenerate button; similarity source is blurb text or, if absent, the memo field; vectorization via the Gemini API free tier if implemented, otherwise a simpler placeholder clustering approach is acceptable given the spec explicitly allows deferring this.
Done when: the graph renders from real collection data and regenerates on demand without re-fetching cover images that are already cached from Phase 4.

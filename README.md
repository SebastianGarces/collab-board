# Collaborative Infinite Canvas Monorepo

Bun workspace monorepo with:

- `apps/backend`: Elysia API + Better Auth + Drizzle + Yjs WebSocket sync
- `apps/frontend`: React + Vite collaborative canvas UI
- `packages/shared`: shared protocol/types for auth and collaboration
- `docker-compose.yml`: Postgres container only

## 1) Prerequisites

- Bun installed
- Docker + Docker Compose installed

## 2) Setup

1. Copy env file:

```bash
cp .env.example .env
```

2. Install workspace dependencies:

```bash
bun install
```

3. Start Postgres only:

```bash
bun run db:up
```

4. Run Drizzle Kit migrations for Better Auth tables:

```bash
bun run migrate
```

5. Start backend + frontend:

```bash
bun run dev
```

Apps:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- Health: `http://localhost:3000/api/health`

## 3) Database Container Commands

```bash
bun run db:up
bun run db:logs
bun run db:down
docker compose ps
```

Only Postgres is containerized. Backend and frontend run locally with Bun.

## 4) Authentication

Better Auth is mounted on backend via `auth.handler`, exposing `/api/auth/*`.

- Email/password sign up and sign in are enabled.
- Frontend uses Better Auth React client.
- Auth session endpoint for app usage: `GET /api/me`.

## 5) Collaboration and CRDT

Uses Yjs CRDT over a custom Elysia WebSocket endpoint. Cursor presence is stored
in a shared `Y.Map<PresenceState>` on the Yjs document -- no separate awareness
protocol or managed real-time provider is used.

- Endpoint: `/ws/collab/:roomId`
- Protocol: Yjs sync (message type `0`) over binary WebSocket frames
- In-memory room manager per `roomId`
- Each user broadcasts cursor position via the shared CRDT map
- Remote cursors are rendered in all other clients in the same room

## 6) Smoke Test Checklist

1. Open two browser windows.
2. In both, create/sign in with separate users.
3. Navigate both to `http://localhost:5173/canvas/main`.
4. Move cursor in one window and confirm it appears in the other.
5. Verify auth guard by signing out and reopening `/canvas/main` (redirects to `/login`).

## 7) Scripts

```bash
bun run dev           # backend + frontend
bun run dev:backend   # backend only
bun run dev:frontend  # frontend only
bun run typecheck     # all workspaces
bun run migrate       # drizzle-kit generate + migrate
bun run db:up         # postgres up
bun run db:logs       # postgres logs
bun run db:down       # postgres down
```

# Build an MV CloudCore Engine Dashboard

## Goal
Replace the placeholder home page with a live dashboard that talks to the C++ engine over HTTP (running as a separate process on port 9090). The dashboard will surface health, jobs, metrics, resources, memory, scheduler queues, and let users submit/cancel jobs.

## Plan

### 1. Engine proxy server route
Create `src/routes/api/engine/$.ts` — a catch-all server route that forwards requests from the browser to the engine. This avoids CORS and keeps the engine URL configurable via `ENGINE_URL` env var (default `http://127.0.0.1:9090`).

- `GET /api/engine/health` → engine `/health`
- `GET /api/engine/jobs` → engine `/api/jobs`
- `GET /api/engine/jobs/:id` → engine `/api/jobs/:id`
- `POST /api/engine/jobs` → engine `/api/jobs`
- `DELETE /api/engine/jobs/:id` → engine `/api/jobs/:id`
- `GET /api/engine/metrics` → engine `/api/metrics`
- `GET /api/engine/resources` → engine `/api/resources`
- `GET /api/engine/memory` → engine `/api/memory`
- `GET /api/engine/scheduler/queues` → engine `/api/scheduler/queues`
- `POST /api/engine/scheduler/policy` → engine `/api/scheduler/policy`
- `POST /api/engine/tenants/credits` → engine `/api/tenants/credits`
- `GET /api/engine/logs` → engine `/api/logs`

### 2. Engine client library
Create `src/lib/engine.ts` with typed functions that call the proxy route and return strongly typed DTOs (Job, Metrics, Resources, MemoryStats, QueueState, etc.).

### 3. Dashboard UI
Rewrite `src/routes/index.tsx` as the dashboard home. Use TanStack Query to fetch data on an interval. Sections:
- Header with engine status badge and current policy
- Submit job form (name, type, priority, cores, memory, estimated ms, tenant, user)
- Jobs table with cancel action
- Metrics cards (avg waiting, turnaround, CPU util, throughput, completed/failed/running/queued)
- Resources bar (cores, memory, thread pool)
- Memory blocks table
- Scheduler queue levels + recent decisions
- Live log tail

### 4. Shared layout
Add a lightweight header/nav in `src/routes/__root.tsx` around `<Outlet />` so the dashboard has navigation and branding.

### 5. SEO/head metadata
Give the home route a proper `head()` with title, description, og tags, and twitter card.

## Files to create/edit
- `src/routes/api/engine/$.ts` (new)
- `src/lib/engine.ts` (new)
- `src/lib/engine.types.ts` (new)
- `src/routes/index.tsx` (rewrite)
- `src/routes/__root.tsx` (edit for layout/head)
- `src/styles.css` (minor token tweaks if needed)

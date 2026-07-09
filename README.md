# KnightHyve

Multi-device synchronized video recording for mascot teams, athletic
organizations, and performance groups. A single admin command triggers
synchronized recording across every connected device in a session; footage is
aggregated for multi-angle review with timestamped feedback.

## Repository layout

This is a **monorepo**. All three surfaces share one set of Socket.IO event
names and API contracts.

| Path           | Stack                          | Purpose                                  |
| -------------- | ------------------------------ | ---------------------------------------- |
| `apps/server`  | Express + Socket.IO + Postgres | API, auth, real-time sync hub            |
| `apps/web`     | React (Vite)                   | Admin / coach review + management UI     |
| `apps/mobile`  | Flutter                        | Recording app (joins sessions, records)  |

## Tech stack (per the project plan)

- **Backend:** Express.js, Socket.IO (real-time), PostgreSQL
- **Web:** React
- **Mobile:** Flutter
- **Sync:** shared server clock (TrueTime-style offset) over Socket.IO
- **Storage/delivery:** AWS S3 + Cloudflare Stream (later)
- **Deploy:** AWS EC2 (later)

## Local development

### Option A: Docker Compose (server + web + Postgres)

Each service reads its config from a gitignored `.env` file, so secrets never
land in git. Copy the templates once before the first run:

```bash
cp .env.example .env                    # shared Postgres credentials
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

Edit the values (e.g. `POSTGRES_PASSWORD` in the root `.env`) as needed —
`docker-compose.yml` falls back to the dev defaults shown in `.env.example`
if a variable isn't set.

#### Dev Container

```bash
docker compose up -d
```

#### Build Container

```bash
docker compose up --build
```

This starts Postgres, the Express/Socket.IO server (hot reload via
`node --watch`), and the Vite dev server (hot reload) together:

- Server: http://localhost:4000 (health: GET /health)
- Web: http://localhost:5173
- Postgres: localhost:5432

Source is bind-mounted into the `server` and `web` containers, so local edits
are picked up automatically. Run `docker compose up -d --build` to run in the
background, and `docker compose down` to stop.

#### Initialize database tables

With `db` up, apply `apps/server/src/db/schema.sql` (safe to re-run — every
statement is `CREATE TABLE IF NOT EXISTS`):

```bash
docker compose run --rm db-init
```

### Option B: Run services natively

#### 1. Start Postgres

```bash
docker compose up -d db
```

#### 2. Run the server

```bash
cd apps/server
cp .env.example .env
npm install
npm run dev          # http://localhost:4000  (health: GET /health)
```

#### 3. Run the web app

```bash
cd apps/web
cp .env.example .env
npm install
npm run dev          # http://localhost:5173
```

### 4. Mobile startup (Flutter)

Flutter isn't scaffolded yet. Once the Flutter SDK is installed:

```bash
cd apps/mobile
flutter create .
```

See `apps/mobile/README.md`.

## Status

Early scaffold. Implemented: repo structure, server boilerplate with a health
check and a Socket.IO session-room + recording-command skeleton, web
boilerplate, local Postgres. **Not** yet implemented: auth, persistence,
recording, uploads, playback, comments.

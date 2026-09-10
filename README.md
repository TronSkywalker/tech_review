# Pokétrace — Sentry showcase

Ten lightweight Pokémon-named Node.js services, an HTTP API adapter, and a plain HTML/CSS/JavaScript dashboard. Every service runs in its own process or container. No database, frontend build, or Sentry account is needed to start.

## Run locally

Requires Node.js 22 or newer.

```sh
npm ci
npm start
```

Open **http://localhost:3000**. Stop all services with Ctrl+C. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

The adapter listens on port 3000; services use 4101–4110. Local processes bind to `127.0.0.1`. Set `PORT` to change the adapter port, or `HOST` to change the bind address. Run individual services with `SERVICE_NAME` and `PORT` environment variables using `node src/server.cjs`. Each destination can be overridden with e.g. `PIKACHU_URL`.

## Run with Docker

Requires Docker with Compose v2.24 or newer (optional env-file support).

```sh
docker compose up --build
```

The same dashboard is at http://localhost:3000. Only the adapter is published to the host; services communicate on the internal Compose network. Stop with `docker compose down`. No persistent volumes are created.

## Self-hosted Sentry in Docker Compose

The demo now includes a separate **official Sentry 26.8.0** deployment via `compose.sentry.yaml`. It runs the full upstream stack, including ingestion, workers, PostgreSQL, Kafka, ClickHouse, and Redis, to support the tracing, errors, and logs scenarios. Its UI is at **http://localhost:9000**; the demo dashboard stays on port 3000. Sentry has persistent Docker volumes and a seven-day event retention setting.

Before installation, allocate at least **14000 MiB RAM and 4 CPUs to Docker** (16 GB allocated is a practical target with the demo). Use Docker Compose **2.32.2+** and Linux containers. Sentry's installer requires **Bash 4.4+**. On Windows, install a WSL Linux distribution such as Ubuntu and enable Docker Desktop's WSL integration for it. Docker Desktop's internal `docker-desktop` distribution is not an installer environment. The helper checks Docker resources before installing or starting Sentry.

On the machine checked during setup, Docker had only **6858 MiB** and no user WSL distribution, so **Sentry was prepared and its Compose configuration validated, but it has not been installed or started**. Increase the Docker/WSL memory allocation and provide the Linux environment before continuing. Official references: [release 26.8.0](https://github.com/getsentry/self-hosted/releases/tag/26.8.0), [requirements](https://github.com/getsentry/self-hosted/blob/26.8.0/install/_min-requirements.sh), [installer](https://github.com/getsentry/self-hosted/blob/26.8.0/install.sh).

Run these from the repository root (use `npm.cmd` in PowerShell if needed):

```sh
npm run sentry:prepare
npm run sentry:install
npm run sentry:user
npm run sentry:up
```

`sentry:prepare` downloads the official release into the ignored `.sentry/self-hosted` directory and verifies its pinned commit. It creates local settings without overwriting existing ones. `sentry:install` runs the official installer to build images, generate Sentry's signing secret, create volumes, and migrate databases. On Windows it invokes Bash in your WSL distribution; set `SENTRY_WSL_DISTRO` if you have multiple distributions. The installer may take several minutes and download multiple gigabytes. Upstream installation telemetry is disabled.

`sentry:user` prompts you for the administrator credentials. It creates no demo service projects. `sentry:up` starts Sentry and waits for its health checks. Log in at http://localhost:9000 and create your organization and projects yourself.

To connect the demo containers, use the DSN public key and project ID shown by your local Sentry project, replacing the public `localhost:9000` authority with the internal `sentry` hostname:

```dotenv
# Example shape only; replace the public key and project ID with yours.
SENTRY_DSN_PIKACHU=http://<public-key>@sentry/<project-id>
```

Then start/recreate the demo with its additional network attachment:

```sh
docker compose -f compose.yaml -f compose.local-sentry.yaml up -d --build
```

The `sentry` hostname resolves to Sentry's Nginx ingress on port 80. A DSN containing `localhost:9000` would point at the demo container itself. If you run the demo with `npm start` on the host instead, keep the DSN's `localhost:9000` address and no additional Compose file is needed.

```sh
npm run sentry:status
npm run sentry:logs
npm run sentry:config
# Stop the demo first so its containers detach from the shared network:
docker compose -f compose.yaml -f compose.local-sentry.yaml down
npm run sentry:down
```

Stopping Sentry retains its persistent volumes. Keep `.sentry/self-hosted` too: it contains your generated secrets and configuration. Local settings are in `.sentry/self-hosted/.env.custom` and `.sentry/self-hosted/sentry/config.yml`. The root `.env` remains exclusively for the demo's DSNs. The setup helper uses the full upstream environment and the `feature-complete` Compose profile; prefer the `sentry:*` commands over invoking the Sentry Compose file without those settings. The base `docker compose up` workflow remains available for Sentry SaaS or an unconfigured demo.

## Onboard Sentry yourself

1. Copy `.env.example` to `.env`.
2. Create Node.js/Express projects in your Sentry organization for the services you want to observe, plus the adapter. Put each project's DSN in its corresponding `SENTRY_DSN_<NAME>` variable. Alternatively, use one `SENTRY_DSN` for all services; the `service` tag distinguishes them.
3. Restart the demo. For Docker, run `docker compose up -d --force-recreate`.
4. Run a dashboard scenario, then inspect traces, issues, and logs in Sentry. Use the returned trace ID and the `scenario`, `service`, and `demo.request_id` tags to correlate activity. Allow a few seconds for SDK batches to arrive.

Keep all projects in the same Sentry organization for cross-project exploration and configure DSNs for every hop, including the adapter, for a complete trace. “Sentry ready” on the dashboard means a DSN is configured, not that remote ingestion has been verified. The dashboard displays local responses; it does not query Sentry.

The reusable SDK adapter is `src/sentry.cjs`. It initializes before Express/HTTP imports, enables 100% trace sampling for the demo, captures handled and unhandled errors, adds service/environment/release tags, and enables structured Sentry logs. Native fetch instrumentation propagates trace context between services. Custom spans surround work and dependency calls. Sentry service projects are created by you, and no auth token is required for SDK ingestion. `.env` and the local `.sentry` checkout are ignored by Git and excluded from demo Docker builds.

SDK references: [Express setup](https://docs.sentry.io/platforms/javascript/guides/express/), [distributed tracing](https://docs.sentry.io/platforms/javascript/guides/node/tracing/distributed-tracing/), [logs](https://docs.sentry.io/platforms/javascript/guides/node/logs/).

## Review walkthrough

| Dashboard scenario / endpoint | Expected behavior | What to inspect in Sentry |
| --- | --- | --- |
| `POST /api/run/healthy` | HTTP 200, ten service calls | One distributed trace with parallel branches and custom spans |
| `POST /api/run/slow` | HTTP 200, Snorlax waits 1.8 seconds | The warehouse span dominates the critical path |
| `POST /api/run/error` | HTTP 502, Gengar throws | Root exception in Gengar, downstream errors in Squirtle and Pikachu, trace-linked logs |
| `POST /api/run/handled` | HTTP 200, Psyduck uses a fallback | A captured exception and warning log despite a successful request |
| `POST /api/run/nplus1` | HTTP 200, 18 service calls | Eight sequential Eevee → Meowth calls; a visible N+1 pattern |

The repeated-call scenario demonstrates the waterfall pattern; it does not promise an automatically detected Sentry performance issue. Delays and failures are deliberately simulated; no actual payment, inventory, notification, or database operations occur. Repeated errors have stable messages for issue grouping. This showcase covers server-side tracing, errors, logs, and custom instrumentation; it does not include browser replay, profiling, or source-map uploads.

```text
Dashboard → Adapter → Pikachu (coordinator, 4101)
                       ├─ Bulbasaur (inventory, 4102)
                       │    ├─ Eevee (recommendations, 4105)
                       │    │    └─ Meowth ×8 [nplus1 only]
                       │    └─ Snorlax (warehouse, 4109)
                       ├─ Charmander (preparation, 4103)
                       │    ├─ Meowth (payments, 4107)
                       │    └─ Psyduck (risk checks, 4108)
                       └─ Squirtle (delivery, 4104)
                            ├─ Jigglypuff (notifications, 4106)
                            └─ Gengar (rewards, 4110)
```

The adapter also exposes `GET /api/catalog` and `GET /api/health`. Every process exposes `GET /health`; each Pokémon exposes `GET /work/:scenario`. Unknown scenarios return HTTP 400. Downstream calls time out after six seconds and return a visible error node.

```sh
curl -X POST http://localhost:3000/api/run/error
npm test
```

The integration test launches eleven processes on ports 24101–24111 and a local Sentry envelope receiver. It checks all scenarios, cross-service trace IDs, emitted errors/transactions/logs, invalid scenarios, and an unreachable service. It uses no real DSNs and sends no telemetry to Sentry. Regenerate Compose after changing the catalog with `node scripts/compose.cjs`.

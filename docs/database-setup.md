# Local PostgreSQL and Prisma

## PostgreSQL service

The root `compose.yaml` uses the pinned official `postgres:17.11-alpine3.24` image, a named `bisect_postgres_data` volume, a readiness health check, automatic restart behavior, and a port bound only to `127.0.0.1:5432`. Compose reads `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` from the ignored root `.env` file. The example password must be replaced locally. No production credentials belong in this file.

```sh
pnpm db:up
pnpm db:health
pnpm db:down
```

Stopping the service preserves data. Starting it again uses the same named volume. No reset or volume deletion is part of the standard workflow. From WSL, connect to the published Windows loopback port using `127.0.0.1`; if the selected WSL/Docker networking mode does not expose localhost forwarding, use the documented Docker Desktop host gateway and adjust the local-only database URL after verifying connectivity.

## Prisma

Prisma `7.10.1`, `@prisma/adapter-pg` `7.10.1`, and `pg` `8.23.1` are owned by `apps/indexer`. The schema at `apps/indexer/prisma/schema.prisma` currently contains only `HealthCheck`; it exists to verify generated typed access and real PostgreSQL reads/writes. Prisma 7 reads the datasource URL from `apps/indexer/prisma.config.ts` and uses the PostgreSQL driver adapter at runtime.

```sh
pnpm db:generate
pnpm --filter @bisect/indexer db:validate
pnpm db:migrate
pnpm db:smoke
```

`db:migrate` uses `prisma migrate dev` in development. CI applies committed migrations with `prisma migrate deploy`. The smoke script inserts, reads, and removes one row; it does not reset the database. `pnpm db:restart-check` writes a unique row, restarts only the PostgreSQL container, verifies that exact row remains, and removes it. This check does not delete or reset the database volume.

## Verified environment

On 2026-10-31, Docker Desktop `4.97.0` ran its Linux engine on WSL 2. PostgreSQL became healthy, the initial Prisma migration applied, Prisma authenticated through `DATABASE_URL` and completed read/write, and a database row survived the container restart check. The aggregate `pnpm check:all` passed. See `docs/environment-verification.md` for command-level results. No production database is configured.

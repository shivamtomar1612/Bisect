# Development setup

## Tool versions

- Node.js: `24.19.0` in `.node-version` for CI; the root manifest accepts Node 24.x because the installed pnpm lifecycle environment reported `24.22.1`.
- pnpm: `11.25.0` (`packageManager` in the root manifest)
- Foundry: `v1.8.7` (see `docs/windows-wsl-setup.md`)
- PostgreSQL: `17.11` in Compose
- Prisma CLI, client, and PostgreSQL adapter: `7.10.1`
- Base Sepolia: chain ID `84532`

## JavaScript workspace

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

The root scripts use pnpm filters and Node scripts, so they work from PowerShell, Git Bash, and WSL. `pnpm check:all` runs the complete local validation, including Docker/PostgreSQL, Prisma migration and read/write smoke test, Base Sepolia read-only chain ID check, Foundry, and Playwright. It stops at the first required failure. Pure TypeScript checks do not depend on Docker.

## Environment values

Copy `.env.example` to `.env`, then set a strong local development password and update both `POSTGRES_PASSWORD` and the URL-encoded password in `DATABASE_URL`. `.env` is ignored by Git. Public testnet RPC and local Anvil settings are separate. A deployer key is deliberately absent because no deployment script currently uses one.

## Common commands

```sh
pnpm db:up
pnpm db:health
pnpm db:generate
pnpm db:migrate
pnpm db:smoke
pnpm db:down
pnpm contracts:build
pnpm contracts:test
pnpm check:base-sepolia
```

`db:down` stops PostgreSQL but keeps the named data volume. Do not use `docker compose down -v` for ordinary development. The Prisma schema contains only a health-check row until the application phase defines durable protocol data.

## Current machine status

See [environment-audit.md](environment-audit.md) and [environment-verification.md](environment-verification.md). Windows has restarted and the optional WSL features are enabled, but the WSL package and Ubuntu are not installed. Docker Desktop is installed but its Linux engine is unavailable, so PostgreSQL and real database checks cannot run yet. Do not treat setup instructions as proof a service is working.

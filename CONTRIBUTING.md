# Contributing

BISECT is at the foundation stage. Protocol behavior must be specified before implementation, and each implementation phase must close with executable evidence.

## Before changing code

1. Read `AGENTS.md` and the relevant sections of `docs/architecture.md`.
2. Check `docs/decisions.md` for settled and unresolved protocol choices.
3. Identify the requirement IDs in `docs/requirements.md` that the change addresses.
4. Keep work within the documented deterministic VM, bounded inputs, and explicit bond accounting constraints.

## Development workflow

```sh
pnpm install
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

For Solidity changes, also run `pnpm contracts:build` and the relevant Foundry tests. For user-facing flows, run the Playwright suite where its browser is available. Do not replace unavailable checks with claims or simulated output; record the limitation in `docs/progress.md`.

## Change expectations

- Add tests for behavior and regressions. Financial operations and dispute transitions require adversarial tests.
- Update the requirements matrix when implementation or test evidence changes.
- Update protocol decisions and architecture docs when semantics change.
- Do not commit secrets, local environment files, generated credentials, or unreviewed build artifacts.
- Use conventional commit subjects when committing: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, or `security:`.

## Reporting

Describe changed files, commands actually run, their results, unavailable tooling, and remaining risks. A passing static check is not evidence of deployment, audit, or protocol correctness.

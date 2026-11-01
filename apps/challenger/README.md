# BISECT challenger bot

The optional Phase 15 service watches the configured v1 dispute registry, reads each confirmed claim's program and public input from contract storage, and independently runs the canonical VM and Merkle SDK. It ignores matching roots and opens a bonded dispute only when the execution context matches and the independently generated root differs.

The service is fail-closed and dry-run by default. It never reads an application user's wallet, accesses the frontend, modifies the Phase 8 ledger, or overrides contract settlement. A broadcaster uses a dedicated bot account configured for Base Sepolia or local Anvil. The contract remains authoritative for challenge eligibility, move ordering, timeout outcomes, and pull-credit settlement.

## Commands

From the repository root:

```powershell
pnpm challenger:help
pnpm --filter @bisect/challenger exec tsx src/cli.ts status
pnpm --filter @bisect/challenger exec tsx src/cli.ts inspect 12
pnpm --filter @bisect/challenger exec tsx src/cli.ts verify 12
pnpm --filter @bisect/challenger exec tsx src/cli.ts dry-run 12
pnpm challenger start
```

For a compiled service run, use `pnpm build:challenger` first, then `pnpm --filter @bisect/challenger start`. The root `pnpm challenger start` command runs the TypeScript source through `tsx` for local development.

`inspect` and `verify` replay one on-chain claim and show the canonical result. `dry-run` evaluates eligibility and required bond without sending a transaction. `start` polls claims, records structured status, and stays in dry-run unless all broadcast settings below are explicitly configured. `stop` creates an emergency-stop file, `resume` clears that file, `disable` blocks startup/actions, and `enable` removes the disable file.

## Configuration

The environment template contains safe commented placeholders. The required read-only settings are:

- `BISECT_BOT_RPC_URL`
- `BISECT_BOT_CHAIN_ID` (`31337` for Anvil or `84532` for Base Sepolia)
- `BISECT_BOT_REGISTRY_ADDRESS`
- `BISECT_BOT_DEPLOYMENT_BLOCK`

Base Sepolia uses six confirmations by default; local Anvil uses one. The Base Sepolia setting cannot be reduced to zero. The bot checks the live chain ID and the registry's protocol, VM, and encoding version before it scans or writes.

Broadcasting additionally requires `BISECT_BOT_BROADCAST=true`, a dedicated `BISECT_BOT_PRIVATE_KEY`, and positive values for all three limits:

- `BISECT_BOT_MAX_TOTAL_SPEND_WEI`: cumulative bond exposure plus actual gas spend. Bond exposure is counted conservatively and is not removed when a bond is later credited or withdrawn.
- `BISECT_BOT_MAX_BOND_WEI`: maximum exact bond allowed for any dispute.
- `BISECT_BOT_MAX_GAS_PER_TX_WEI`: maximum quoted transaction gas cost. The bot bounds the transaction gas price and gas limit before sending.

Set a dedicated `BISECT_BOT_ADDRESS` to make the signer visible in status output and verify that it matches the private key. Keep the private key in a secret manager or protected process environment. Do not store it in the repository, `.env.example`, frontend, database, state file, or logs. An unlocked JSON-RPC account is supported only on chain `31337` when both `BISECT_BOT_USE_UNLOCKED_ACCOUNT=true` and `BISECT_BOT_UNLOCKED_ADDRESS` are set. Never enable this option on a public network.

The default RPC is local Anvil and the default registry is unset, so the bot cannot start against a public deployment without explicit configuration. It does not deploy contracts. The current repository does not configure a Base Sepolia registry address or deployment block.

## State, retries, and reorganization recovery

The bot atomically stores its confirmed event checkpoint, block hash, per-claim challenge status, transaction hashes, exposure totals, and active game identifiers. State and JSONL logs default to `.bisect/`, which is ignored by Git. A process lock prevents two bot instances from acting on the same state file.

On normal `SIGINT`/`SIGTERM`, the service stops polling and releases its lock after the current operation returns. If the process or host is killed, first confirm the bot is no longer running, then remove the stale `<state-path>.lock` file before restarting. Never delete the state JSON as a shortcut: it contains the challenge deduplication and spend-reservation records.

Read/poll failures retry for at most `BISECT_BOT_MAX_RETRIES` consecutive cycles (default three); exceeding the limit stops the process. A submitted transaction with no conclusive receipt is never resent automatically. If the RPC response is ambiguous after a possible send, the bond/gas reservation remains and the claim is marked uncertain until an operator reconciles the transaction. A persisted transaction hash is checked for its receipt after restart. After a mined revert, the bot rereads the current contract state before deciding whether an action is still needed.

The bot compares its confirmed checkpoint hash and replays canonical registry events from the configured deployment block after a reorganization. This can be slower for a long history, but it avoids silently skipping events when the prior common ancestor is unknown. Challenge attempts and spend reservations survive rewinds, preventing a reorg from automatically reusing a bond. A missing state file or an ambiguous send requires operator review. Reorganizations can remove a just-included bot move; the bot re-reads contract state and does not assume a transaction remains canonical.

Structured JSONL records distinguish observed, verified honest, suspicious, submitted, confirmed, refused, timed out, and settled states. They include hashes, block numbers, exact wei, and contract outcomes. Logs never include the private key.

## Trace and availability behavior

The v1 claim stores immutable program bytes, the eight public inputs, transition budget, claimed root, output, and context. It does not publish the prover's complete trace in a protocol data store. The bot recomputes the canonical trace from the on-chain program and input and constructs its own root, initial proof, bisection children, and terminal transition proofs. It does not need to download the prover's full trace to challenge; the prover must reveal its committed child hashes and terminal proof on-chain when called. If the prover withholds a required move, the contract timeout rule applies.

A stale indexer, failed RPC read, unavailable endpoint, or transport error is not a fraud witness. The bot does not challenge until it has successfully read a context-consistent claim and independently computed a differing root. An unavailable RPC during a live game may still cause the bot to miss the contract deadline; operators remain responsible for uptime and funded gas.

## Test and limitations

Run the pure unit suite with `pnpm test`. Build contracts first, then run the actual local transaction demonstration:

```powershell
pnpm contracts:build
pnpm challenger:e2e
```

The E2E script starts a private local Anvil chain, deploys the current dispute contract, submits one honest and two invalid-trace claims, authorizes an Anvil-only unlocked bot account, completes one real dispute, checks the exact pull credit and accounting invariant, tests spend-cap and insufficient-balance refusals, replays events against contract liabilities, exercises a controlled reorganization, and verifies that an RPC outage sends no transaction. It uses real local test ETH and real contract receipts, not simulated outcomes.

The Phase 15 integration check reconciles protocol events and aggregate contract custody in memory. It does not connect to the Phase 8 PostgreSQL projection in the same E2E process. No Base Sepolia transaction, deployment, independent audit, production hardening, or uptime guarantee is claimed.

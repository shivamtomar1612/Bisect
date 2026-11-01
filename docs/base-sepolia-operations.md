# Base Sepolia deployment and operations

**State: deployment prepared, public deployment not performed.** This runbook targets Base Sepolia (`84532`) only. The repository has no production key, deployer account, contract address, hosting target, cloud credential, or explorer API key. The deployment script refuses every chain ID except `84532`; the `BisectClaimRegistry` base contract and Phase 16 benchmark harness are not deployable targets.

## Contract topology

Deploy exactly one contract: `BisectDisputeRegistryV1`. It includes the claim registry, dispute state machine, verifier calls, escrow liabilities, and pull withdrawals. The verifier library is compiled into the registry; no separate verifier deployment is required. The deployment has no owner, upgrade key, treasury, or administrator withdrawal path. Do not deploy `BisectClaimRegistry` alone: it is intentionally fail-closed. Do not deploy `DirectExecutionBenchmark`.

The deployment entry point is `contracts/script/BaseSepoliaDeploy.s.sol`. It checks `block.chainid == 84532`, requires explicit bond/window environment values, rejects values outside the contract's supported ranges before casting, starts Foundry broadcasting only after validation, and reads back the deployed version and constructor values. It never reads a private key from environment variables. Signing is provided by a local encrypted Foundry keystore account.

The initial deployment manifest is [`deployments/base-sepolia.json`](../deployments/base-sepolia.json). It explicitly records `not-deployed` and null address/receipt fields; these are absence markers, not example addresses. Generated ABIs are in `packages/sdk/src/abis/`.

## Network and constructor parameters

The Base Sepolia RPC check was executed successfully: `eth_chainId` returned `84532`. The configured public RPC is `https://sepolia.base.org`; the explorer is `https://sepolia.basescan.org`. The chain ID definition is also documented by [Base's `eth_chainId` reference](https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_chainId).

Constructor parameters are immutable: `bondWei`, `challengeWindowBlocks`, and `turnWindowBlocks`. The contract enforces a nonzero `uint96` bond, challenge window from 1 to 1,000,000 blocks, and turn window from 1 to 100,000 blocks. There is no default testnet policy in the deployment script; values must be supplied explicitly and recorded with the deployment.

For review only, a candidate demonstration profile is:

| Parameter        |                                 Candidate | Rationale and limit                                                                                                                                                               |
| ---------------- | ----------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bond             | `1000000000000000` wei (`0.001` test ETH) | Small testnet collateral; matches the Phase 16 local benchmark bond. It is not a previously approved public deployment value.                                                     |
| Challenge window |                             `3600` blocks | Gives observers a longer block-based opportunity to challenge than the Phase 16 local fixture.                                                                                    |
| Turn window      |                              `120` blocks | Allows a participant time to prepare and submit a proof while a game is active. At the v1 maximum of 26 responses, the full game can still span up to 3,120 blocks after opening. |

These are proposed values, not a decision embedded in code. They do not guarantee a wall-clock duration: block production, RPC availability, transaction inclusion, and participant liveness vary. Test ETH is collateral and remains distinct from gas fees. The contract charges no protocol fee.

## Signer and deployment procedure

Never send a private key or seed phrase to Codex, put one in `.env`, or expose one as a `NEXT_PUBLIC_` variable. The supported local workflow is an encrypted Foundry keystore; the installed Foundry CLI supports interactive key import and account selection. See [Foundry Forge](https://www.getfoundry.sh/forge/index.html) and [Cast](https://www.getfoundry.sh/cast/index.html).

1. Create or select a dedicated Base Sepolia deployer account outside this chat. Import it locally with `cast wallet import bisect-base-sepolia-deployer --interactive`; enter the private key only in the local terminal and protect the encrypted keystore with a strong password. Do not use `--private-key` or `--unsafe-password`.
2. Fund that address with enough Base Sepolia test ETH for the deployment and later verification calls. Record the public deployer address. Check its balance using `cast balance <address> --rpc-url https://sepolia.base.org`. Do not assume a gas amount; the deployment transaction must be simulated against the current RPC before broadcast.
3. Set the three constructor parameters and public address in the current PowerShell process. Example candidate values (review before setting):

   ```powershell
   $env:BASE_SEPOLIA_RPC_URL = "https://sepolia.base.org"
   $env:BASE_SEPOLIA_BOND_WEI = "1000000000000000"
   $env:BASE_SEPOLIA_CHALLENGE_WINDOW_BLOCKS = "3600"
   $env:BASE_SEPOLIA_TURN_WINDOW_BLOCKS = "120"
   $env:BASE_SEPOLIA_DEPLOYER_ADDRESS = Read-Host "Public deployer address"
   ```

4. Re-run `pnpm check:base-sepolia`, then simulate without `--broadcast`:

   ```powershell
   forge script --root contracts script/BaseSepoliaDeploy.s.sol:BaseSepoliaDeploy `
     --rpc-url $env:BASE_SEPOLIA_RPC_URL `
     --account bisect-base-sepolia-deployer
   ```

   Inspect the constructor values, target chain, sender, transaction data, and current fee estimate. Simulation does not create a public transaction.
5. Only after reviewing the simulation and confirming the dedicated account has test ETH, broadcast explicitly:

   ```powershell
   forge script --root contracts script/BaseSepoliaDeploy.s.sol:BaseSepoliaDeploy `
     --rpc-url $env:BASE_SEPOLIA_RPC_URL `
     --account bisect-base-sepolia-deployer `
     --broadcast
   ```

   Add Foundry's `--verify` and `--etherscan-api-key $env:BASESCAN_API_KEY` only when an explorer key is configured in the process environment. If explorer verification is unavailable, verify through the BaseScan contract page when supported; do not report source verification as successful until it is visible.
6. Record the actual contract address, deployer, transaction hash, block number, constructor parameters, and runtime code hash in `deployments/base-sepolia.json`. Set `BASE_SEPOLIA_REGISTRY_ADDRESS`, `BASE_SEPOLIA_DEPLOYMENT_TX_HASH`, and `BASE_SEPOLIA_DEPLOYMENT_BLOCK` in local/server configuration. Then run `pnpm verify:base-sepolia-deployment`; it checks the canonical receipt, deployer, six-block confirmation depth, runtime code, v1 getters, and immutable constructor values without sending transactions.
7. Copy the verified address into `NEXT_PUBLIC_BISECT_REGISTRY_ADDRESS` only for the frontend build. Configure the indexer with the same address and the actual deployment block. Never let the frontend, indexer, and challenger use different registries or chain IDs.

## Testnet financial demonstration

Use two separately controlled, dedicated test accounts: a prover and a challenger. The deployer is not automatically either user. Keep the bot signer separate if the automated challenger is enabled. Every claim, challenge, bisection move, terminal proof, and withdrawal must be wallet/keystore-authorized and confirmed from a real receipt. The deployer account must not be exposed to the web server or public API.

The test path is:

1. Submit a Studio-generated claim from the prover, using the exact configured bond and keeping the canonical program, input, and trace export available to both participants.
2. Read back claim context, root, status, and locked liabilities from the contract. Wait for the deployment/indexer confirmation policy before treating records as confirmed.
3. From the challenger, independently execute the identical context, compare trace evidence, and open a challenge only with an authenticated valid witness. Never infer fraud from a matching/different output alone.
4. Complete all required child-hash turns and terminal evidence before the on-chain block deadlines. Use actual contract events and reads to determine the result.
5. Confirm pull credits through `withdrawableCredit`, then issue user-initiated withdrawals and check the receipts, contract balance, and indexed ledger after reconciliation.

No public trace archive or retention service is deployed by this repository. A Merkle root does not publish the trace. For a testnet demo, both participants must preserve and exchange the canonical trace artifacts securely before the challenge window; the prover must retain its committed trace through all responses. If the prover withholds a required response, the contract's timeout rule applies. If the challenger lacks its independent trace/proofs, the game cannot be opened safely.

## Hosting, database, and operations

No hosting platform or cloud account is selected or connected. No web, indexer, challenger, or managed PostgreSQL service was deployed. The existing Compose file is for local development, not a production database. Before public hosting:

- Select a Next.js-capable host for the web app and a private-network-capable service for the indexer/API. Build with Node `24.19.0` and pnpm `11.25.0`.
- Provision PostgreSQL with TLS/private networking, a unique least-privilege database user, encrypted backups and a tested restore path. Set `DATABASE_URL` through the host's secret manager, not a committed file.
- Configure `INDEXER_RPC_URL`, `INDEXER_CHAIN_ID=84532`, `INDEXER_CONTRACT_ADDRESS`, `INDEXER_DEPLOYMENT_BLOCK`, and the reviewed confirmation/reorg bounds. Run migrations before starting the indexer. Do not expose database credentials or signer values to the frontend.
- The read API exposes `/healthz`, which checks database reachability and indexer lag, plus `/v1/indexer/status` and `/v1/reconciliation`. Monitor these, the confirmed-block lag, contract solvency, and each active dispute deadline. The API defaults to loopback binding; use a private service network or an authenticated TLS reverse proxy if the web server must reach it remotely.
- Keep the challenger disabled/dry-run until a separate low-balance testnet bot signer, explicit broadcast opt-in, bond/spend/gas caps, persistent state, and emergency stop are verified. A missed deadline can lose the bot bond.
- Back up PostgreSQL, indexer checkpoint/state, and trace artifacts independently. After a reorg, inspect canonical block hashes and reconciliation before treating ledger projections as current. Never correct on-chain balances from a database job.

No external monitoring, backup, public HTTPS, cloud secret manager, or service-level alerting is configured in this repository. The protocol remains unaudited; testnet deployment would not make it production-secure.

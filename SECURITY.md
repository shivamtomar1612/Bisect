# Security policy

## Scope and status

BISECT is an unaudited early-stage protocol. The current foundation contains no deployed contracts, no custody or payout logic, and no production-ready security guarantees. Do not use it to secure real assets.

## Reporting a vulnerability

Do not open a public issue containing exploit details or secrets. Contact the repository maintainer privately through the contact method on the GitHub profile and include:

- affected commit or release;
- affected component and configuration;
- reproducible steps and impact;
- any suggested mitigation.

Do not include private keys, seed phrases, production credentials, or personal data in a report.

## Security requirements for implementation

- Threat-model protocol transitions, replay, griefing, timeout manipulation, malformed commitments, overflow, reentrancy, and denial of service.
- Test all bond deposits, accounting updates, withdrawals, slashing, and timeout paths with adversarial callers and boundary values.
- Bound VM instruction count, memory, calldata, commitment size, and all loops that can affect on-chain gas.
- Use domain-separated cryptographic commitments and document encoding and hash assumptions before relying on them.
- Pin Solidity compiler and dependencies. Use OpenZeppelin utilities where appropriate; do not treat a library dependency as an audit.
- Never put a signing key in the web app, indexer, CI logs, or repository. Challenger signing must be isolated and explicitly configured.
- Report deployment and audit evidence separately; testnet deployment is not a security audit.

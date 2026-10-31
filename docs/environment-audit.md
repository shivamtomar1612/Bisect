# Environment audit

Audit date: 2026-10-31. Repository: `D:\Bisect` on Windows 11 Home Single Language, build 26200, x64. This is the existing checkout; no repository recreation or migration was performed.

## Findings after the requested restart

| Component                | Observed state                                                                                                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows / virtualization | Windows 11 x64. WSL and Virtual Machine Platform optional features were enabled before the restart. Firmware virtualization and SLAT were previously verified.                                                                                                            |
| WSL / Ubuntu             | `wsl --status` and `wsl --list --verbose` report that WSL is not installed. No Linux distribution is installed. Installing the Microsoft WSL package through an elevated prompt was canceled, so no further elevation attempt was made.                                   |
| Git                      | Git for Windows `2.54.0.windows.1`; remote `origin` is `https://github.com/shivamtomar1612/Bisect.git`; no prior commit/history was present at initial audit. Repo-local author identity is `Shivam` and the user-supplied email.                                         |
| Node / pnpm              | Node.js `v24.19.0` (matches `.node-version`); pnpm `11.25.0`; Corepack is available.                                                                                                                                                                                      |
| PowerShell / Git Bash    | PowerShell `7.6.5` and Git Bash are installed; Git Bash is available at `C:\Program Files\Git\bin\bash.exe`.                                                                                                                                                              |
| Foundry                  | Repository-local Foundry `1.8.7` is installed under ignored `.tools/`; `forge`, `anvil`, `cast`, and `chisel` report that version. The official Windows x64 release archive checksum was verified during installation.                                                    |
| Solidity / OpenZeppelin  | Solidity compiler `0.8.30`; OpenZeppelin Contracts pinned as submodule tag `v5.5.0`; ReentrancyGuard import smoke test compiles and passes.                                                                                                                               |
| Docker Desktop           | Docker Desktop `4.97.0` is installed. Docker CLI `29.9.2` and Compose `v5.6.1` run. The Desktop Linux engine is not running: `docker info` cannot open `dockerDesktopLinuxEngine`, and the Docker service is stopped. Desktop startup previously terminated unexpectedly. |
| PostgreSQL               | No local PostgreSQL server was found. The Compose configuration is valid, but no container/database can run until the Docker engine is operational.                                                                                                                       |
| Prisma                   | Prisma and adapter packages are pinned at `7.10.1`; schema validation and client generation pass. Actual migration, authentication, read/write, reconnection, and persistence checks require PostgreSQL and have not run.                                                 |
| Base Sepolia             | Read-only RPC check returned chain ID `84532`. No contract was deployed.                                                                                                                                                                                                  |
| Environment / secrets    | `.env.example` contains placeholders; a local ignored `.env` contains development-only credentials. It is not staged or tracked. No deployment key is configured.                                                                                                         |

## pnpm install-script review

Workspace policy allows only `@prisma/engines@7.10.1`, `esbuild@0.25.12`, and `prisma@7.10.1`, after reviewing their pinned manifests and package scripts. The optional native accelerators `bufferutil@4.1.0`, `keccak@3.0.4`, and `utf-8-validate@5.0.10` remain denied; they are not required for the current checks. The lockfile pins these exact versions. No blanket script approval was enabled.

## Environment conclusion

The requested restart completed, but it did not install the WSL package or Ubuntu. Docker Desktop is installed but not operational. The remaining manual system step is to approve the elevated Microsoft WSL installation, then install and initialize Ubuntu and start Docker Desktop with WSL2 integration. Until Docker reports a healthy daemon, the local PostgreSQL/real Prisma integration acceptance checks remain blocked. This is an environment limitation, not evidence that those checks passed.

# Windows and WSL setup

## Current machine status

Windows 11 x64 remains the host operating system. WSL 2 and Virtual Machine Platform are enabled. Docker Desktop `4.97.0` uses its internal `docker-desktop` WSL 2 distribution, and `docker info` succeeds. The current `wsl --list --verbose` does not show a developer Ubuntu distribution.

An Ubuntu install was attempted as part of setup. The first `wsl --install -d Ubuntu` did not return in the non-interactive shell, so it was stopped. A retry with `--web-download --no-launch` returned `Wsl/InstallDistro/ERROR_ALREADY_EXISTS` but still did not register Ubuntu. No WSL files or distributions were manually removed. This does not block the project's Windows-native Node/pnpm and repository-local Foundry workflows, which passed the full verification.

## Optional Ubuntu developer shell

If an Ubuntu shell is desired, inspect WSL distributions and the installed Ubuntu app before retrying the installer. Do not unregister Docker Desktop distributions or delete WSL data to resolve `ERROR_ALREADY_EXISTS`. Once Ubuntu is registered, initialize its Linux username at first launch, keep it on WSL 2, and enable it in Docker Desktop's WSL integration. Verify `wsl --list --verbose` and `docker info` afterward.

## Repository and Foundry

The checkout stays at `D:\Bisect`; a WSL distro sees it at `/mnt/d/Bisect`. The repository-local Windows Foundry installation (`.tools/foundry-v1.8.7`) compiles and tests Solidity and runs Anvil JSON-RPC checks. Do not install a second Foundry version unless moving development into Ubuntu; if doing so, pin the same version and document the command path.

The tested app, database tools, and pnpm workspace currently run from Windows PowerShell. A WSL Ubuntu environment needs its own Linux Node/pnpm installation; do not reuse Windows `node_modules` as a Linux dependency tree.

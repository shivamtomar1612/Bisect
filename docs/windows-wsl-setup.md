# Windows and WSL setup

## Current machine status

Windows 11 x64 remains the host operating system. WSL and Virtual Machine Platform optional features are enabled and the user has restarted Windows. The Microsoft WSL package itself is still absent (`wsl --status` reports that WSL is not installed); Ubuntu is absent too. An elevated WSL installation was canceled, and it will not be retried without a new user instruction. Docker Desktop `4.97.0` is installed, but its Linux engine is unavailable until WSL is installed and Docker Desktop can start.

## Manual completion steps

In an Administrator PowerShell window, approve and run the official WSL installation:

```powershell
wsl --install
wsl --install -d Ubuntu
```

Accept the Windows elevation prompt. If the first command requests another restart, complete that restart. Launch Ubuntu once and create the Linux username and password at its first-run prompt, then run `wsl --update` and check `wsl --status` and `wsl --list --verbose`. Keep Ubuntu on WSL 2. These steps add the Linux subsystem and a Linux distribution; they do not replace Windows.

Open Docker Desktop, accept any first-run terms, and enable its WSL integration for Ubuntu. Verify `docker info` succeeds before starting PostgreSQL. If Docker Desktop still exits unexpectedly, capture its diagnostic message and confirm hardware virtualization is enabled; do not change firmware settings as part of repository setup.

## Repository and Foundry

The existing checkout stays at `D:\Bisect`; WSL sees it at `/mnt/d/Bisect`. The current repository-local Windows Foundry installation (`.tools/foundry-v1.8.7`) already builds and tests Solidity. Do not install a second Foundry version unless the Windows build proves insufficient; if switching to WSL Foundry, pin the same version and document the command path.

From PowerShell, use the checked root scripts for contracts and Anvil. From Ubuntu, access `/mnt/d/Bisect` and install Node/pnpm in that Linux environment before running workspace commands there. Do not assume Windows `node_modules` works as a Linux dependency tree.

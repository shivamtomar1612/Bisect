import { dryRunClaim, getBotStatus, inspectClaim, startBot } from "./bot.js";
import { loadChallengerConfig } from "./config.js";
import { controlPaths, setControlFile } from "./state-store.js";

const [command, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  if (command === undefined || command === "--help" || command === "help") {
    printHelp();
    return;
  }
  const config = loadChallengerConfig();
  switch (command) {
    case "status": {
      const status = await getBotStatus(config);
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    case "inspect":
    case "verify": {
      const claimId = parseClaimId(args[0]);
      console.log(JSON.stringify(await inspectClaim(config, claimId), null, 2));
      return;
    }
    case "dry-run": {
      const claimId = parseClaimId(args[0]);
      await dryRunClaim(config, claimId);
      return;
    }
    case "start": {
      if (args.length !== 0)
        throw new Error(
          "start does not accept arguments; broadcasting is controlled by environment configuration.",
        );
      await startBot(config);
      return;
    }
    case "stop":
      await setControlFile(controlPaths(config.statePath).emergencyStop, true);
      console.log("Emergency stop enabled. The running bot will stop on its next cycle.");
      return;
    case "resume":
      await setControlFile(controlPaths(config.statePath).emergencyStop, false);
      console.log("Emergency stop cleared. Broadcasting still requires explicit configuration.");
      return;
    case "disable":
      await setControlFile(controlPaths(config.statePath).disabled, true);
      console.log("Challenger disabled. Use `enable` to clear the disable control.");
      return;
    case "enable":
      await setControlFile(controlPaths(config.statePath).disabled, false);
      console.log("Challenger enabled. Broadcasting still requires explicit configuration.");
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function parseClaimId(value: string | undefined): bigint {
  if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
    throw new Error("Claim ID must be a positive decimal integer.");
  }
  return BigInt(value);
}

function printHelp(): void {
  console.log(`BISECT automated challenger (Phase 15)

Usage:
  bisect-challenger status
  bisect-challenger inspect <claimId>
  bisect-challenger verify <claimId>
  bisect-challenger dry-run <claimId>
  bisect-challenger start
  bisect-challenger stop | resume | disable | enable

The bot runs in dry-run mode unless BISECT_BOT_BROADCAST=true is set with an
explicit signer and positive spend, bond, and gas caps. Base Sepolia is never
selected implicitly. See apps/challenger/README.md before authorizing a signer.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ event: "cli_error", message }));
  process.exitCode = 1;
});

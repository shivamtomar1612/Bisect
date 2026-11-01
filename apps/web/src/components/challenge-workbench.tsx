"use client";

import {
  bisectDisputeRegistryV1Abi,
  generateTraceCommitment,
  type TraceCommitmentArtifact,
} from "@bisect/sdk";
import { useCallback, useEffect, useState } from "react";
import { type Address, encodeFunctionData, formatEther, type Hex } from "viem";
import {
  initialChallengeProof,
  terminalChallengeProof,
  traceChildren,
} from "../lib/challenge-evidence";
import {
  getWalletProvider,
  publicClient,
  registryAddress,
  requireTransactionWallet,
  sendRegistryTransaction,
  walletAccount,
  walletChain,
  walletChainId,
  walletChainName,
} from "../lib/wallet-chain";

const abi = bisectDisputeRegistryV1Abi;
const phases = ["none", "bisection", "terminal", "closed"];
const outcomes = [
  "pending",
  "prover transition valid",
  "challenger timed out",
  "prover transition invalid",
  "prover timed out",
  "terminal commitment inconsistency",
];

async function readClaim(registry: Address, claimId: bigint) {
  return publicClient.readContract({
    address: registry,
    abi,
    functionName: "getClaim",
    args: [claimId],
  });
}
async function readGame(registry: Address, claimId: bigint, gameNumber: bigint) {
  return publicClient.readContract({
    address: registry,
    abi,
    functionName: "getGame",
    args: [claimId, gameNumber],
  });
}
type Claim = Awaited<ReturnType<typeof readClaim>>;
type Game = Awaited<ReturnType<typeof readGame>>;

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The request did not complete.";
}

export function ChallengeWorkbench({
  claimIdText,
  indexerStatus,
}: {
  claimIdText: string;
  indexerStatus: string;
}) {
  const claimId = BigInt(claimIdText);
  const registry = registryAddress();
  const [claim, setClaim] = useState<Claim | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [gameNumber, setGameNumber] = useState<bigint>(0n);
  const [block, setBlock] = useState<bigint | null>(null);
  const [bond, setBond] = useState<bigint | null>(null);
  const [wallet, setWallet] = useState<Address | null>(null);
  const [walletNetwork, setWalletNetwork] = useState<number | null>(null);
  const [credit, setCredit] = useState<bigint | null>(null);
  const [trace, setTrace] = useState<TraceCommitmentArtifact | null>(null);
  const [traceError, setTraceError] = useState("");
  const [error, setError] = useState("");
  const [stage, setStage] = useState("");
  const [hash, setHash] = useState<Hex | null>(null);
  const [gasWei, setGasWei] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!registry) return;
    const [nextClaim, activeNumber, latestNumber, nextBlock, nextBond, nextWallet, nextNetwork] =
      await Promise.all([
        readClaim(registry, claimId),
        publicClient.readContract({
          address: registry,
          abi,
          functionName: "activeGameNumber",
          args: [claimId],
        }),
        publicClient.readContract({
          address: registry,
          abi,
          functionName: "latestGameNumber",
          args: [claimId],
        }),
        publicClient.getBlockNumber(),
        publicClient.readContract({ address: registry, abi, functionName: "bondWei" }),
        walletAccount(false),
        getWalletProvider() ? walletChain() : Promise.resolve(null),
      ]);
    setClaim(nextClaim);
    const nextNumber = activeNumber > 0n ? activeNumber : latestNumber;
    setGameNumber(nextNumber);
    setGame(nextNumber > 0n ? await readGame(registry, claimId, nextNumber) : null);
    setBlock(nextBlock);
    setBond(nextBond);
    setWallet(nextWallet);
    setWalletNetwork(nextNetwork);
    setCredit(
      nextWallet
        ? await publicClient.readContract({
            address: registry,
            abi,
            functionName: "withdrawableCredit",
            args: [nextWallet],
          })
        : null,
    );
  }, [registry, claimId]);

  useEffect(() => {
    let active = true;
    void refresh().catch((cause) => {
      if (active) setError(errorText(cause));
    });
    const provider = getWalletProvider();
    const changed = () => {
      void refresh().catch((cause) => setError(errorText(cause)));
    };
    provider?.on?.("accountsChanged", changed);
    provider?.on?.("chainChanged", changed);
    window.addEventListener("bisect:wallet-changed", changed);
    const poll = window.setInterval(changed, 12_000);
    return () => {
      active = false;
      window.clearInterval(poll);
      provider?.removeListener?.("accountsChanged", changed);
      provider?.removeListener?.("chainChanged", changed);
      window.removeEventListener("bisect:wallet-changed", changed);
    };
  }, [refresh]);

  function runIndependentTrace() {
    if (!claim) return;
    try {
      const result = generateTraceCommitment({
        program: claim.program,
        publicInput: claim.publicInput,
        transitionCount: claim.transitionCount,
      });
      if (result.executionContextHash.toLowerCase() !== claim.contextHash.toLowerCase())
        throw new Error("Execution context does not match the on-chain claim.");
      setTrace(result);
      setTraceError("");
      setGasWei(null);
    } catch (cause) {
      setTrace(null);
      setTraceError(errorText(cause));
    }
  }

  const differentRoot =
    claim && trace ? claim.traceRoot.toLowerCase() !== trace.traceRoot.toLowerCase() : false;
  const eligible = Boolean(
    claim &&
      trace &&
      differentRoot &&
      claim.status === 1 &&
      block !== null &&
      block <= claim.challengeDeadline &&
      wallet &&
      wallet.toLowerCase() !== claim.prover.toLowerCase() &&
      walletNetwork === walletChainId &&
      bond !== null &&
      !busy,
  );
  const actor = game?.expectedResponder ?? null;
  const myTurn = Boolean(
    game &&
      wallet &&
      actor?.toLowerCase() === wallet.toLowerCase() &&
      block !== null &&
      block <= game.deadlineBlock &&
      walletNetwork === walletChainId &&
      !busy,
  );
  const myTraceRoot =
    wallet && claim && game
      ? wallet.toLowerCase() === claim.prover.toLowerCase()
        ? claim.traceRoot
        : wallet.toLowerCase() === game.challenger.toLowerCase()
          ? game.challengerRoot
          : null
      : null;
  const usableTrace =
    trace && myTraceRoot && trace.traceRoot.toLowerCase() === myTraceRoot.toLowerCase()
      ? trace
      : null;

  async function transact(data: Hex, value = 0n) {
    if (busy) return;
    setBusy(true);
    setError("");
    setHash(null);
    try {
      const signer = await requireTransactionWallet();
      setStage("Review the bond and gas in your wallet.");
      const receipt = await sendRegistryTransaction({
        ...signer,
        data,
        value,
        onHash: (nextHash) => {
          setHash(nextHash);
          setStage("Submitted; waiting for a successful receipt.");
        },
      });
      setStage(`Confirmed in block ${receipt.blockNumber.toString()}. Refreshing contract state.`);
      await refresh();
    } catch (cause) {
      setStage("");
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  function openingData() {
    if (!trace) throw new Error("Run the independent trace first.");
    return encodeFunctionData({
      abi,
      functionName: "challenge",
      args: [claimId, trace.traceRoot, initialChallengeProof(trace)],
    });
  }

  async function estimateOpeningGas() {
    try {
      if (!eligible || !registry || !wallet || bond === null)
        throw new Error("Challenge preconditions are not met.");
      const [units, price] = await Promise.all([
        publicClient.estimateGas({
          account: wallet,
          to: registry,
          data: openingData(),
          value: bond,
        }),
        publicClient.getGasPrice(),
      ]);
      setGasWei(units * price);
      setError("");
    } catch (cause) {
      setGasWei(null);
      setError(errorText(cause));
    }
  }

  async function openChallenge() {
    if (!eligible || bond === null) return;
    await transact(openingData(), bond);
  }

  async function submitMove() {
    if (!myTurn || !usableTrace || !game) return;
    try {
      let data: Hex;
      if (game.phase === 1) {
        const expectedNode =
          wallet?.toLowerCase() === claim?.prover.toLowerCase()
            ? game.proverNode
            : game.challengerNode;
        if (!expectedNode) throw new Error("The active subtree is unavailable.");
        const children = traceChildren(
          usableTrace,
          game.subtreeBaseIndex,
          game.subtreeHeight,
          expectedNode,
        );
        data = encodeFunctionData({
          abi,
          functionName: "revealChildren",
          args: [claimId, gameNumber, children.left, children.right],
        });
      } else if (game.phase === 2) {
        data = encodeFunctionData({
          abi,
          functionName: "revealTerminal",
          args: [claimId, gameNumber, terminalChallengeProof(usableTrace, game.differentIndex)],
        });
      } else throw new Error("This dispute has no active move.");
      await transact(data);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  async function timeout() {
    if (
      !game ||
      game.phase === 0 ||
      game.phase === 3 ||
      block === null ||
      block <= game.deadlineBlock
    )
      return;
    await transact(
      encodeFunctionData({ abi, functionName: "claimTimeout", args: [claimId, gameNumber] }),
    );
  }

  if (!registry)
    return (
      <div className="card pad">
        <h2>Challenger unavailable</h2>
        <p>A verified registry address must be configured before live disputes can be opened.</p>
      </div>
    );
  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="callout">
        {walletChainName} testnet · registry {registry}. The indexer reports: {indexerStatus}. A
        Merkle root alone does not publish trace data; the prover must make its committed trace
        available for inspection. Withheld data can prevent an independent pre-opening witness, and
        the UI does not infer availability from a root.
      </div>
      {!claim ? (
        <div className="card pad">
          <h2>Loading on-chain claim</h2>
          <button className="button" type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          <section className="card pad">
            <h2>Claim #{claimIdText}</h2>
            <p>
              Prover: <code>{claim.prover}</code>
            </p>
            <p>
              Program bytes: <code style={{ overflowWrap: "anywhere" }}>{claim.program}</code>
            </p>
            <p>Public input: {claim.publicInput.map((value) => value.toString()).join(", ")}</p>
            <p>
              Claimed output: {claim.claimedOutput.toString()} · transitions:{" "}
              {claim.transitionCount}
            </p>
            <p>
              Trace root: <code style={{ overflowWrap: "anywhere" }}>{claim.traceRoot}</code>
            </p>
            <p>
              Challenge deadline: block {claim.challengeDeadline.toString()} · current block{" "}
              {block?.toString() ?? "unavailable"}
            </p>
            <p>
              Prover bond: {bond === null ? "unavailable" : `${formatEther(bond)} test ETH`} ·
              status {claim.proposerBondLocked ? "locked" : "released or credited"}
            </p>
            <button type="button" className="button" onClick={runIndependentTrace}>
              Run independent VM and Merkle verification
            </button>
            {traceError ? <p role="alert">{traceError}</p> : null}
          </section>
          {trace ? (
            <section className="card pad">
              <h2>Independent evidence</h2>
              <p>
                Canonical output:{" "}
                {trace.states[trace.transitionCount]?.registers[0] ?? "unavailable"}
              </p>
              <p>
                Canonical root: <code style={{ overflowWrap: "anywhere" }}>{trace.traceRoot}</code>
              </p>
              <p>
                {differentRoot
                  ? "Authenticated roots differ. The challenger can commit to this independently generated valid trace."
                  : "Canonical trace root matches the claim. There is no valid disagreement from this execution."}
              </p>
              <p>Matching output alone never establishes trace correctness.</p>
              <p>
                Challenger bond: {bond === null ? "unavailable" : `${formatEther(bond)} test ETH`}{" "}
                locked on opening. A losing challenger can forfeit this bond. Gas is a separate
                wallet cost.
              </p>
              <button
                type="button"
                className="button"
                disabled={!eligible}
                onClick={() => void estimateOpeningGas()}
              >
                Estimate gas
              </button>
              <span style={{ marginLeft: 12 }}>
                {gasWei === null
                  ? "No gas estimate"
                  : `Estimated gas cost: ${formatEther(gasWei)} test ETH`}
              </span>
              <p>
                <button
                  type="button"
                  className="button primary"
                  disabled={!eligible}
                  onClick={() => void openChallenge()}
                >
                  Open bonded challenge
                </button>
              </p>
            </section>
          ) : null}
          {game ? (
            <section className="card pad">
              <h2>Dispute #{gameNumber.toString()}</h2>
              <p>
                Phase: {phases[game.phase] ?? "unknown"} · outcome:{" "}
                {outcomes[game.outcome] ?? "unknown"}
              </p>
              <p>
                Current actor: <code>{game.expectedResponder}</code> · deadline block{" "}
                {game.deadlineBlock.toString()}
              </p>
              <p>
                Interval base {game.subtreeBaseIndex}, height {game.subtreeHeight}; selected
                differing index {game.differentIndex}
              </p>
              <p>
                Challenger bond: {game.challengerBondLocked ? "locked" : "released or credited"} ·
                current wallet:{" "}
                {myTurn ? "authorized to move" : "not authorized or deadline passed"}
              </p>
              <button
                type="button"
                className="button primary"
                disabled={!myTurn || !usableTrace || (game.phase !== 1 && game.phase !== 2)}
                onClick={() => void submitMove()}
              >
                Submit authenticated {game.phase === 1 ? "child hashes" : "terminal proof"}
              </button>
              <button
                type="button"
                className="button"
                disabled={
                  busy ||
                  block === null ||
                  block <= game.deadlineBlock ||
                  (game.phase !== 1 && game.phase !== 2)
                }
                onClick={() => void timeout()}
              >
                Claim expired turn
              </button>
              <p>
                Only contract events settle bonds. Wallet credit:{" "}
                {credit === null ? "unavailable" : `${formatEther(credit)} test ETH`}. Credited
                funds remain in escrow until a separate successful withdrawal.
              </p>
              <a href="/account-ledger">Open Account Ledger</a>
            </section>
          ) : null}
          <button type="button" className="button" onClick={() => void refresh()}>
            Refresh chain state
          </button>
        </>
      )}
      {walletNetwork !== null && walletNetwork !== walletChainId ? (
        <p role="alert">Wrong wallet network. Switch to {walletChainName} before submitting.</p>
      ) : null}
      {stage ? <p role="status">{stage}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {hash ? (
        <p>
          Transaction:{" "}
          {walletChainId === 84532 ? (
            <a href={`https://sepolia.basescan.org/tx/${hash}`} target="_blank" rel="noreferrer">
              {hash}
            </a>
          ) : (
            <code>{hash}</code>
          )}
        </p>
      ) : null}
    </div>
  );
}

"use client";

import {
  bisectDisputeRegistryV1Abi,
  createExecutionStateProof,
  generateTraceCommitment,
  verifyExecutionStateProof,
} from "@bisect/sdk";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatEther, type Hex } from "viem";
import { type Replay, replayDisputeTimeline } from "../lib/dispute-replay";
import { publicClient, registryAddress, walletChainId } from "../lib/wallet-chain";
import { ExplorerLink } from "./ui";

export function DisputeVisualizer({
  data,
  claimId,
  gameNumber,
  simulation = false,
}: {
  data: unknown;
  claimId: string;
  gameNumber: string;
  simulation?: boolean;
}) {
  const parsed = useMemo(() => {
    try {
      return {
        replay: simulation
          ? (data as Replay)
          : replayDisputeTimeline(data, { claimId, gameNumber }),
        error: null,
      };
    } catch (cause) {
      return {
        replay: null,
        error: cause instanceof Error ? cause.message : "Timeline could not be verified.",
      };
    }
  }, [data, claimId, gameNumber, simulation]);
  const replay = parsed.replay;
  const [selected, setSelected] = useState(0);
  const [stateProof, setStateProof] = useState<{
    side: string;
    siblings: readonly Hex[];
    leaf: Hex;
  } | null>(null);
  const [liveCreditWei, setLiveCreditWei] = useState<bigint | null>(null);
  useEffect(() => {
    if (
      !replay ||
      simulation ||
      !replay.winner ||
      replay.chainId !== walletChainId ||
      !replay.contractAddress ||
      registryAddress()?.toLowerCase() !== replay.contractAddress
    )
      return;
    let active = true;
    void publicClient
      .readContract({
        address: replay.contractAddress as `0x${string}`,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "withdrawableCredit",
        args: [replay.winner as `0x${string}`],
      })
      .then((value) => {
        if (active) setLiveCreditWei(value);
      })
      .catch(() => {
        if (active) setLiveCreditWei(null);
      });
    return () => {
      active = false;
    };
  }, [replay, simulation]);
  useEffect(() => {
    if (
      !replay ||
      simulation ||
      replay.finalIndex === null ||
      replay.chainId !== walletChainId ||
      replay.claimId === null ||
      replay.contractAddress === null ||
      registryAddress()?.toLowerCase() !== replay.contractAddress
    )
      return;
    const verifiedClaimId = replay.claimId;
    let active = true;
    void (async () => {
      const claim = await publicClient.readContract({
        address: replay.contractAddress as `0x${string}`,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "getClaim",
        args: [BigInt(verifiedClaimId)],
      });
      const trace = generateTraceCommitment({
        program: claim.program,
        publicInput: claim.publicInput,
        transitionCount: claim.transitionCount,
      });
      const side =
        trace.traceRoot.toLowerCase() === replay.proverRoot.toLowerCase()
          ? "prover"
          : trace.traceRoot.toLowerCase() === replay.challengerRoot.toLowerCase()
            ? "challenger"
            : null;
      if (!side) return;
      const proof = createExecutionStateProof({ trace, stateIndex: replay.finalIndex as number });
      if (
        !verifyExecutionStateProof({
          proof,
          program: trace.programHex,
          publicInput: trace.publicInput,
          transitionCount: trace.transitionCount,
          expectedRoot: trace.traceRoot,
        })
      )
        return;
      if (active) setStateProof({ side, siblings: proof.siblingsBottomUp, leaf: proof.leafHash });
    })().catch(() => {
      if (active) setStateProof(null);
    });
    return () => {
      active = false;
    };
  }, [replay, simulation]);
  if (parsed.error || !replay)
    return (
      <section className="card pad" role="alert">
        <h2>Timeline cannot be authenticated</h2>
        <p>{parsed.error}</p>
        <p>No missing round has been reconstructed.</p>
      </section>
    );
  const total = replay.rounds.length;
  const step = Math.min(selected, total + (replay.complete || replay.finalIndex !== null ? 1 : 0));
  const round = step > 0 && step <= total ? replay.rounds[step - 1] : null;
  const low = round
    ? round.retained === "left"
      ? round.low
      : round.midpoint
    : step > total && replay.finalIndex !== null
      ? replay.finalIndex
      : 0;
  const high = round
    ? round.retained === "left"
      ? round.midpoint - 1
      : round.high
    : step > total && replay.finalIndex !== null
      ? replay.finalIndex
      : replay.transitionCount;
  const width = ((high - low + 1) / (replay.transitionCount + 1)) * 100;
  const left = (low / (replay.transitionCount + 1)) * 100;
  return (
    <div className="dispute-viz">
      <div className={`callout ${simulation ? "viz-simulation" : ""}`} role="note">
        <strong>
          {simulation
            ? "EDUCATIONAL SIMULATION — no blockchain transaction or settlement"
            : "CONFIRMED CHAIN EVENTS"}
        </strong>
        <span>
          {simulation
            ? "These commitments come from the real VM and hash functions, but the rounds were generated locally."
            : `Indexer lag: ${replay.lagBlocks} blocks. Only confirmed canonical events are replayed.`}
        </span>
      </div>
      {replay.issue ? (
        <p className="callout" role="status">
          {replay.issue}
        </p>
      ) : null}
      <div className="viz-summary">
        <section className="card pad">
          <span className="eyebrow">Execution history</span>
          <strong>{replay.transitionCount.toLocaleString()} transitions</strong>
          <p>{replay.transitionCount + 1} committed states</p>
        </section>
        <section className="card pad">
          <span className="eyebrow">Authenticated rounds</span>
          <strong>{total}</strong>
          <p>Each completed round halves the candidate interval.</p>
        </section>
        <section className="card pad">
          <span className="eyebrow">Possible states remaining</span>
          <strong>{high - low + 1}</strong>
          <p>
            State indices {low}–{high}
          </p>
        </section>
      </div>
      <section className="card pad viz-stage" aria-live="polite">
        <div className="section-head">
          <div>
            <span className="eyebrow">
              Step {step} / {total + 1}
            </span>
            <h2>
              {round
                ? `Round ${round.round}: keep the ${round.retained} half`
                : step > total
                  ? "One disputed state remains"
                  : "Start with the full execution"}
            </h2>
          </div>
          <span className="chip">{high - low + 1} candidates</span>
        </div>
        <p>
          {round
            ? `Both parties opened their ordered child commitments. ${round.retained === "left" ? "The left child hashes differ, so the first disagreement is in the earlier half." : "The left child hashes agree, so the first disagreement must be in the later half."}`
            : step > total
              ? `The first disputed state is ${replay.finalIndex ?? "not yet isolated"}. Its predecessor is the common low state. In a real completed proof, Solidity checks the adjacent authenticated states and computes the unique valid VM successor; a missed turn follows the timeout rule.`
              : "The prover and challenger commit to complete, context-bound execution traces. Their roots differ while the initial state agrees."}
        </p>
        <div className="viz-axis">
          <span>0</span>
          <span>State index</span>
          <span>{replay.transitionCount}</span>
        </div>
        <div
          className="viz-track"
          role="img"
          aria-label={`Retained interval from state ${low} through ${high} out of states 0 through ${replay.transitionCount}`}
        >
          <div className="viz-retained" style={{ left: `${left}%`, width: `${width}%` }} />
          {round ? (
            <div
              className="viz-midpoint"
              style={{ left: `${(round.midpoint / (replay.transitionCount + 1)) * 100}%` }}
            />
          ) : null}
        </div>
        {round ? (
          <p className="small muted">
            Before round: [{round.low}, {round.high}] · split at state {round.midpoint} · after
            round: [{low}, {high}] · {round.remaining} possible states remain.
          </p>
        ) : null}
        <nav className="viz-controls" aria-label="Replay controls">
          <button
            className="button"
            type="button"
            onClick={() => setSelected(0)}
            disabled={step === 0}
          >
            Restart
          </button>
          <button
            className="button"
            type="button"
            onClick={() => setSelected(Math.max(0, step - 1))}
            disabled={step === 0}
          >
            Previous step
          </button>
          <button
            className="button primary"
            type="button"
            onClick={() => setSelected(Math.min(total + 1, step + 1))}
            disabled={step >= total + 1}
          >
            Next step
          </button>
        </nav>
      </section>
      <section className="card pad">
        <h2>Authenticated commitments</h2>
        <div className="viz-hashes">
          <p>
            <strong>Prover root</strong>
            <code>{replay.proverRoot}</code>
          </p>
          <p>
            <strong>Challenger root</strong>
            <code>{replay.challengerRoot}</code>
          </p>
        </div>
        {round ? (
          <details>
            <summary>Round {round.round} ordered Merkle child proof</summary>
            <p>
              Each left/right pair hashes to its authenticated parent using the v1 Keccak
              domain-separated node hash. The contract checked these openings.
            </p>
            <div className="viz-hashes">
              <p>
                Prover parent <code>{round.proverParent}</code>
              </p>
              <p>
                Prover left <code>{round.proverChildren[0]}</code>
              </p>
              <p>
                Prover right <code>{round.proverChildren[1]}</code>
              </p>
              <p>
                Challenger parent <code>{round.challengerParent}</code>
              </p>
              <p>
                Challenger left <code>{round.challengerChildren[0]}</code>
              </p>
              <p>
                Challenger right <code>{round.challengerChildren[1]}</code>
              </p>
            </div>
            {!simulation && round.transactionHashes && replay.chainId !== null ? (
              <p>
                Prover reveal:{" "}
                <ExplorerLink hash={round.transactionHashes[0]} chainId={replay.chainId} /> ·
                Challenger reveal:{" "}
                <ExplorerLink hash={round.transactionHashes[1]} chainId={replay.chainId} />
              </p>
            ) : null}
          </details>
        ) : null}
        {stateProof ? (
          <details>
            <summary>
              Final state inclusion proof from the canonical {stateProof.side} trace
            </summary>
            <p>
              Leaf <code>{stateProof.leaf}</code>
            </p>
            <ol>
              {stateProof.siblings.map((sibling, index) => (
                <li key={sibling}>
                  Level {index}: <code>{sibling}</code>
                </li>
              ))}
            </ol>
          </details>
        ) : replay.finalIndex !== null && !simulation ? (
          <p className="muted">
            A full state inclusion path is unavailable until the matching trace data can be
            reconstructed or published. Ordered child openings remain authenticated by the contract.
          </p>
        ) : null}
      </section>
      <section className="card pad">
        <h2>Settlement and funds</h2>
        <div className="viz-finance">
          <p>
            Prover bond:{" "}
            {replay.bondWei ? `${formatEther(BigInt(replay.bondWei))} test ETH` : "unavailable"} ·
            indexed status {replay.proverBondStatus ?? "unavailable"}
          </p>
          <p>
            Challenger bond:{" "}
            {replay.bondWei ? `${formatEther(BigInt(replay.bondWei))} test ETH` : "unavailable"} ·
            indexed status {replay.challengerBondStatus ?? "unavailable"}
          </p>
          <p>
            Indexed locked bonds for this game:{" "}
            {replay.bondWei === null ||
            replay.proverBondStatus === null ||
            replay.challengerBondStatus === null
              ? "unavailable"
              : `${formatEther(BigInt(replay.bondWei) * BigInt(Number(replay.proverBondStatus === "LOCKED") + Number(replay.challengerBondStatus === "LOCKED")))} test ETH`}
          </p>
          <p>
            Result:{" "}
            {simulation
              ? "No on-chain outcome"
              : replay.winner
                ? `Winner ${replay.winner}`
                : "Pending or not fully indexed"}
          </p>
          <p>
            Credited withdrawal entitlement:{" "}
            {replay.creditedWei === null
              ? "unavailable"
              : `${formatEther(BigInt(replay.creditedWei))} test ETH`}
            . A credit is not a withdrawal.
          </p>
          {!simulation ? (
            <p>
              Winner’s current contract withdrawable balance:{" "}
              {liveCreditWei === null ? "unavailable" : `${formatEther(liveCreditWei)} test ETH`}.
              This is the wallet’s total contract credit and may include other claims.
            </p>
          ) : null}
        </div>
        <Link className="text-link" href="/account-ledger">
          Open Account Ledger
        </Link>
      </section>
      <nav className="viz-round-list" aria-label="Jump to a round">
        {replay.rounds.map((item) => (
          <button
            key={item.round}
            type="button"
            className={`button ${step === item.round ? "primary" : ""}`}
            aria-current={step === item.round ? "step" : undefined}
            onClick={() => setSelected(item.round)}
          >
            Round {item.round} · {item.retained} · {item.remaining} left
          </button>
        ))}
      </nav>
    </div>
  );
}

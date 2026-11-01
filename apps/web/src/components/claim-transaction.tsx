"use client";

import { bisectDisputeRegistryV1Abi } from "@bisect/sdk";
import { useState } from "react";
import {
  exactEth,
  publicClient,
  registryAddress,
  requireTransactionWallet,
  sendRegistryTransaction,
  walletChainId,
} from "../lib/wallet-chain";
import { type Phase5ClaimSubmission, phase5ClaimCalldata } from "./program-studio-utils";

export function ClaimTransaction({ submission }: { submission: Phase5ClaimSubmission }) {
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setHash(null);
    try {
      const wallet = await requireTransactionWallet();
      const bond = await publicClient.readContract({
        address: wallet.registry,
        abi: bisectDisputeRegistryV1Abi,
        functionName: "bondWei",
      });
      if (bond <= 0n) throw new Error("Registry returned an invalid prover bond.");
      const balance = await publicClient.getBalance({ address: wallet.account });
      if (balance <= bond) throw new Error("Wallet needs the exact bond plus test ETH for gas.");
      setStage(`Review the ${exactEth(bond)} test ETH bond in your wallet.`);
      const receipt = await sendRegistryTransaction({
        ...wallet,
        data: phase5ClaimCalldata(submission),
        value: bond,
        onHash: (hash) => {
          setHash(hash);
          setStage("Transaction submitted. Waiting for a successful chain receipt.");
        },
      });
      setHash(receipt.hash);
      setStage(
        `Confirmed in block ${receipt.blockNumber.toString()}. Indexer records may appear later.`,
      );
    } catch (cause) {
      setStage("");
      setError(cause instanceof Error ? cause.message : "Claim submission did not complete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="button primary"
        onClick={submit}
        disabled={busy || !registryAddress()}
        data-testid="studio-submit-claim"
      >
        {busy ? "Waiting for wallet or confirmation…" : "Submit bonded claim"}
      </button>
      {!registryAddress() ? (
        <p className="small muted">
          Set NEXT_PUBLIC_BISECT_REGISTRY_ADDRESS after verifying a deployment to enable
          transactions.
        </p>
      ) : null}
      {stage ? (
        <p className="small" role="status">
          {stage}
        </p>
      ) : null}
      {hash ? (
        <p className="small">
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
      {error ? (
        <p className="small" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

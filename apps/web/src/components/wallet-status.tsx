"use client";
import { useEffect, useState } from "react";
import { Badge } from "./ui";

type EthereumProvider = {
  request(args: { method: string }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};
declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function WalletStatus() {
  const [account, setAccount] = useState<string | null>(null);
  const [chain, setChain] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;
    const accountsChanged = (...values: unknown[]) =>
      setAccount(Array.isArray(values[0]) ? String(values[0][0] ?? "") || null : null);
    const chainChanged = (...values: unknown[]) => setChain(Number(values[0]));
    void ethereum
      .request({ method: "eth_chainId" })
      .then((id) => setChain(Number.parseInt(String(id), 16)))
      .catch(() => undefined);
    void ethereum
      .request({ method: "eth_accounts" })
      .then((values) => {
        if (Array.isArray(values) && typeof values[0] === "string") setAccount(values[0]);
      })
      .catch(() => undefined);
    ethereum.on?.("accountsChanged", accountsChanged);
    ethereum.on?.("chainChanged", chainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", accountsChanged);
      ethereum.removeListener?.("chainChanged", chainChanged);
    };
  }, []);
  async function connect() {
    if (!window.ethereum) {
      setMessage(
        "Install an EVM wallet to connect. BISECT will never request your recovery phrase.",
      );
      return;
    }
    try {
      const result = await window.ethereum.request({ method: "eth_requestAccounts" });
      const id = await window.ethereum.request({ method: "eth_chainId" });
      setAccount(Array.isArray(result) && typeof result[0] === "string" ? result[0] : null);
      setChain(Number.parseInt(String(id), 16));
      setMessage("");
    } catch {
      setMessage("Wallet connection was not completed.");
    }
  }
  const short = account ? account.slice(0, 6) + "…" + account.slice(-4) : "Wallet disconnected";
  return (
    <fieldset className="top-right wallet-fieldset">
      <legend className="sr-only">Network and wallet status</legend>
      <Badge tone={chain === 84532 ? "good" : chain ? "warn" : "accent"}>
        <span className="dot" />
        <span className="wallet-network-label">
          {chain === 84532
            ? "Base Sepolia connected"
            : chain
              ? "Wrong network"
              : "Network not detected"}
        </span>
      </Badge>
      <button
        type="button"
        className="button"
        onClick={connect}
        aria-label={account ? "Wallet connected" : "Connect wallet"}
      >
        {account ? short : "Connect wallet"}
      </button>
      {message ? (
        <span role="status" className="small wallet-message">
          {message}
        </span>
      ) : null}
    </fieldset>
  );
}

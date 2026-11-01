"use client";
import { useEffect, useState } from "react";
import {
  getWalletProvider,
  switchWalletChain,
  walletAccount,
  walletChain,
  walletChainId,
  walletChainName,
} from "../lib/wallet-chain";
import { Badge } from "./ui";

export function WalletStatus() {
  const [account, setAccount] = useState<string | null>(null);
  const [chain, setChain] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const ethereum = getWalletProvider();
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
    if (!getWalletProvider()) {
      setMessage(
        "Install an EVM wallet to connect. BISECT will never request your recovery phrase.",
      );
      return;
    }
    try {
      setAccount(await walletAccount(true));
      setChain(await walletChain());
      setMessage("");
      window.dispatchEvent(new Event("bisect:wallet-changed"));
    } catch {
      setMessage("Wallet connection was not completed.");
    }
  }
  async function disconnect() {
    try {
      await getWalletProvider()?.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
      setAccount(await walletAccount(false));
      setMessage("Wallet permissions revoked.");
      window.dispatchEvent(new Event("bisect:wallet-changed"));
    } catch {
      setMessage("Disconnect this site in your wallet settings.");
    }
  }
  async function switchNetwork() {
    try {
      await switchWalletChain();
      setChain(await walletChain());
      setMessage("");
      window.dispatchEvent(new Event("bisect:wallet-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Network switch was not completed.");
    }
  }
  const short = account ? account.slice(0, 6) + "…" + account.slice(-4) : "Wallet disconnected";
  return (
    <fieldset className="top-right wallet-fieldset">
      <legend className="sr-only">Network and wallet status</legend>
      <Badge tone={chain === walletChainId ? "good" : chain ? "warn" : "accent"}>
        <span className="dot" />
        <span className="wallet-network-label">
          {chain === walletChainId
            ? `${walletChainName} connected`
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
      {account && chain !== walletChainId ? (
        <button type="button" className="button" onClick={switchNetwork}>
          Switch to {walletChainName}
        </button>
      ) : null}
      {account ? (
        <button type="button" className="button" onClick={disconnect}>
          Disconnect
        </button>
      ) : null}
      {message ? (
        <span role="status" className="small wallet-message">
          {message}
        </span>
      ) : null}
    </fieldset>
  );
}

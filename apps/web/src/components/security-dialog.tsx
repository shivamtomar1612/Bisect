"use client";
import { useRef } from "react";
export function SecurityDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="button" type="button" onClick={() => dialog.current?.showModal()}>
        Review wallet safety
      </button>
      <dialog className="dialog" ref={dialog} aria-labelledby="safety-title">
        <p className="eyebrow">Wallet safety</p>
        <h2 id="safety-title" style={{ margin: "8px 0 12px" }}>
          Keep signing in your wallet
        </h2>
        <p className="muted small">
          BISECT does not collect, store, or ask for private keys or recovery phrases. Inspect the
          network, destination, and request details in your wallet before approving any future
          transaction.
        </p>
        <form method="dialog" noValidate style={{ marginTop: 20, textAlign: "right" }}>
          <button type="submit" className="button primary">
            Close
          </button>
        </form>
      </dialog>
    </>
  );
}

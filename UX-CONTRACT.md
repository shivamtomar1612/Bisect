# BISECT web interaction contract

## Canonical UI Map

### Program Studio behavior

- The example selector and transition-budget selector are native selects. Native popup geometry is accepted; both have visible labels and keyboard/browser-native selection behavior.
- The assembly editor accepts only the bounded BISECT assembly grammar. It never evaluates JavaScript, shell input, or external source. Syntax and operand errors remain inline and are associated with the editor.
- Public inputs are eight decimal-string uint64 values. Values are parsed with the VM's BigInt validator and never pass through floating point.
- Run executes the actual v1 VM and ordered Merkle SDK in the browser. It accepts only the four protocol budgets and the VM's 128-instruction maximum. A run that does not halt is shown as budget-exhausted and cannot produce a claim payload.
- The trace panel virtualizes visible rows, reports the total state count and selected index, and exposes keyboard-operable play, pause, reset, next, previous, and state-selection buttons. The selected-state panel shows PC, halted status, all eight registers, changed-register highlights, canonical state hash, and indexed leaf hash.
- Inclusion proof generation and local verification are separate actions. Feedback binds verification to the selected run's program, input, budget, context, and root. A test control mutates a sibling only in a copy and must show rejection without changing the genuine proof artifact.
- The dishonest-trace fixture is explicitly test-only. Its altered trace root and membership proof demonstrate that Merkle inclusion does not prove transition validity; it cannot be used to prepare a claim.
- Execution bundles contain canonical program bytes, assembly text, exact decimal-string inputs/results, trace states, commitment metadata, and any selected proof. The Phase 5 export mirrors ClaimSubmission and contains locally encoded submitClaim calldata, but does not include or invent msg.value. Preparing or exporting either artifact never opens a wallet or submits a transaction.
- The trace list is the single bounded vertical scroll owner for its virtualized rows. On narrow viewports the editor and state panels stack; register values and hashes may scroll or wrap without creating page-level horizontal overflow.

| Capability     | Canonical owner                | Source of truth                    | Allowed variants | Verification                                  |
| -------------- | ------------------------------ | ---------------------------------- | ---------------- | --------------------------------------------- |
| Select/Listbox | Native activity status filter  | This contract and browser platform | Native select    | E2E accessible-name and disabled-state checks |
| Scrollbar      | Global browser scroll behavior | `DESIGN.md` and global CSS         | Native scrollbar | Narrow viewport table scroll E2E              |

- **Navigation:** The public landing page is `/`; workspace route links own Overview, Program Studio, Claims, Disputes, Account Ledger, Documentation, and Settings. Overview resolves to `/dashboard`; a claim detail is `/claims/{claimId}`. Current route uses `aria-current="page"`. At mobile sizes the sidebar is an overlay; Escape, backdrop, and route selection close it. Focus enters the drawer and wraps while open.
- **Theme:** The header button changes the document theme and stores only `bisect-theme` (`light` or `dark`) in browser local storage. It stores no wallet or financial data.
- **Wallet:** Connect asks the injected provider for account access. It never requests signing on load or exposes a key field. Account and chain change events update visible status. Base Sepolia chain ID 84532 is the testnet target; other connected chain IDs are labeled and are not treated as Base Sepolia. Missing provider and rejected connection show a status message.
- **Financial data:** Unknown values render as unavailable, never zero. Dashboard exposure is the indexed sum of confirmed locked bonds and stays distinct from user wallet balance and withdrawable credits. Amounts use exact integer wei. Activity rows are shown only from successful read API responses. A missing endpoint, unavailable service, invalid response, or missing deployment is explained in place.
- **Lifecycle:** Pending, confirmed, and reverted are distinct labels. Explorer links are rendered only for a validated transaction hash on chain ID 84532 and point to Base Sepolia; other chains show no public explorer link. Claims and dispute evidence is sourced from the indexer's confirmed canonical projections. Proof state defaults to “Not checked.”
- **Filtering:** Claims and disputes use server-side query/status filters and cursor pagination from the read API. Clearing filters returns to the unfiltered list. A successful empty page and a no-match page have distinct messages; an API error is not presented as an empty dataset.
- **Dialog:** The browser-native dialog owns modal focus, Escape behavior, and restoration for wallet safety information. No destructive or financial action is offered.
- **Responsive data:** Financial tables retain their column relationships and scroll horizontally on narrow screens. Controls remain available above the table. The dashboard metrics collapse to fewer columns and remain within the viewport.
- **Accessibility:** Native control semantics, explicit labels, live status feedback, keyboard focus visibility, reduced motion, and a skip link are required. Route content has one page heading and labeled navigation.

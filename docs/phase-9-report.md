# Phase 9 web design system report

## Result

**PASS for the responsive product shell, shared display components, and browser accessibility checks.** The screens are a real Next.js application with working routes, theme switching, browser wallet status, and table-filter behavior when records exist. Registry and indexer data are not wired into the web app, so chain-derived balances and activity remain unavailable. No financial transaction or withdrawal flow was added.

## Screens and behavior

- **Overview:** protocol lifecycle, VM v1 facts, network preview status, and separate wallet balance, locked bond, and withdrawable balance cards. It does not show fabricated counts or amounts.
- **Program Studio:** VM constraints and a clear empty state because the browser editor/executor is not yet connected.
- **Claims and Disputes:** separate public-record views with explicit no-indexed-data states.
- **Account Ledger:** keeps external wallet balance, contract-locked ETH, and withdrawable contract credit separate; no withdrawal action is exposed.
- **Documentation:** protocol, security, developer, and indexer/ledger areas.
- **Settings:** Base Sepolia target details, unconfigured registry notice, and wallet security dialog.

Desktop was visually inspected at 1440×1000. Chromium E2E covered the default desktop viewport and a 390px mobile viewport, including all six named routes, the responsive drawer, keyboard Escape/focus restoration, theme persistence, and the native security dialog.

## Shared components

- `app-shell.tsx`: route navigation, active route, keyboard-accessible responsive drawer, and theme preference.
- `wallet-status.tsx`: injected wallet connection plus `eth_accounts` and `eth_chainId` status. It does not request signatures.
- `ui.tsx`: exact wei/ETH display, status badges, pending/confirmed/reverted lifecycle, proof state, empty/loading/error state, security notice, validated Base Sepolia explorer link, and financial table.
- `activity-table.tsx`: labeled search/status filtering; filters stay disabled until real records are available.
- `security-dialog.tsx`: wallet-safety dialog using the browser's native dialog behavior.
- `format.ts`: exact BigInt wei conversion without floating point.

## Design and accessibility

`DESIGN.md` records palette, type, spacing, responsive layout, motion, and token ownership. `UX-CONTRACT.md` records navigation, wallet, financial display, filter, and dialog behavior. Runtime semantic tokens live in `apps/web/src/app/globals.css`; there are no added runtime dependencies.

The browser accessibility test checks labeled buttons and inputs, language, keyboard navigation, dialog focus return, and 4.5:1 contrast for text, muted, accent, verified, and warning pairs in both themes. The stylesheet also honors reduced-motion preferences. The premium design static audit returned zero findings. No external screen-reader certification or full WCAG audit is claimed.

## Verification

| Command                           | Result                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm lint --reporter=summary`    | Passed; zero warnings/errors. Biome reports existing informational suggestions. |
| `pnpm format:check`               | Passed; 145 files checked.                                                      |
| `pnpm typecheck`                  | Passed across all 7 applicable workspace projects.                              |
| `pnpm test`                       | Passed; 53 tests in 7 files.                                                    |
| `pnpm --filter @bisect/web build` | Passed; overview and six sections statically rendered.                          |
| `pnpm e2e`                        | Passed; 8 Chromium tests.                                                       |
| `pnpm web:a11y`                   | Passed; accessibility and theme contrast smoke test.                            |
| Frontend design strict audit      | Passed; 0 findings.                                                             |

## Limits

- No registry deployment address exists in the repository; claims, disputes, and balances cannot be populated from Base Sepolia.
- Wallet connection is read-only account/chain discovery. The app does not request signing, send transactions, or estimate gas.
- Claim/dispute state components are ready to consume real indexer records, but API integration is not part of this design-system phase.
- Chart components are not populated with placeholder series; the overview uses the actual protocol lifecycle as explanatory content.
- This phase does not establish protocol audit status, testnet deployment, or production security.

# BISECT web design system

## Product point of view

The interface treats a computation trace as an auditable financial obligation. It uses the quiet structure of developer tooling with the clear amounts and state labels of a finance product. The signature detail is the compact protocol lifecycle strip: execute, commit, challenge. It explains the product without implying that a live claim exists.

## Tokens

| Role     | Light     | Dark      | Use                             |
| -------- | --------- | --------- | ------------------------------- |
| Canvas   | `#f5f7fb` | `#0c1425` | Page background                 |
| Surface  | `#ffffff` | `#152036` | Cards, navigation, controls     |
| Text     | `#17233d` | `#f3f6fd` | Primary text                    |
| Muted    | `#64728c` | `#abb8cf` | Supporting text                 |
| Accent   | `#4058ce` | `#a5b1ff` | Links, focus, active navigation |
| Verified | `#06685f` | `#69d4c7` | Confirmed/verified only         |
| Warning  | `#9b6019` | `#f2bd78` | Testnet and caution states      |

Runtime ownership: CSS custom properties in `apps/web/src/app/globals.css`; components consume semantic variables. Financial amounts use integer wei and never convert through floating point. Theme preference is local to the browser and defaults to light.

The browser accessibility smoke test checks the normal-text contrast target (4.5:1) for body, muted, accent, verified, and warning pairs in both themes.

## Type, spacing, and shape

Use system Inter when available with Arial/Helvetica fallback. Headings are compact, semibold, and slightly tightened; amounts and identifiers use stable numeric text. Cards use 15px corners, controls 9px, and status chips are rounded. A 4px spacing rhythm governs gaps; page gutters adapt from 36px desktop to 16px mobile.

## Layout and behavior

The Program Studio is a product workspace, not a code playground: its editor accepts only BISECT assembly, public inputs remain exact decimal uint64 strings, and runs use the bounded local VM and SDK. The instruction editor uses a restrained monospace surface; trace selection, register deltas, and proof metadata use the same semantic surfaces and accent/verified colors as the rest of the app. Long traces use a bounded, virtualized native scroll panel. Proof membership and transition validity are explained separately.

Scrollable product surfaces use a theme-aware scrollbar thumb and track while retaining native scrolling and forced-colors behavior. Runtime CSS variables remain canonical; this document records accepted values and rationale.

Desktop uses a persistent 248px sidebar and a fluid content region. Tablet narrows the sidebar and changes three-column summaries to two columns. Mobile uses an overlay navigation drawer with Escape, focus cycling, and a backdrop; data tables scroll horizontally. Reduced-motion preferences disable transitions. All interactive controls use native buttons, links, search input, or select semantics and visible focus rings.

## Phase 10 routes and read data

The public landing page is `/`. Workspace navigation maps Overview to `/dashboard`, with `/program-studio`, `/claims`, `/disputes`, `/account-ledger`, `/documentation`, and `/settings` retaining the Phase 9 route structure. Individual claims use `/claims/{claimId}`. Search, status filters, and cursor pagination are server-rendered against the configured Phase 8 read API.

The dashboard shows confirmed counts, locked exposure, recent confirmed registry events, checkpoint height, confirmation depth, and indexer lag only after a valid `/v1/overview` response. Claims and disputes are canonical confirmed projections; their transaction links are enabled only for Base Sepolia chain ID 84532. A different indexed chain is identified as such and does not get a misleading Basescan link. An unavailable or malformed API response is an error state, and missing data is never rendered as a successful zero. The Account Ledger remains read-only and does not imply a connected wallet has an on-chain credit.

## Shared component owners

`ui.tsx` owns exact wei formatting, status badges, transaction lifecycle, proof status, empty/loading/error presentation, chain-aware explorer links, wallet security notice, and financial table markup. `explorers.tsx` owns validated search/status forms, confirmed claims/disputes tables, and cursor navigation. `dashboard.tsx` renders the overview API response and synchronization status. `read-api.ts` validates the server-only indexer API boundary. `wallet-status.tsx` reads public account/chain state from an injected EVM provider without requesting a signature. `app-shell.tsx` owns route navigation and theme. `security-dialog.tsx` owns the native modal pattern. There are no transaction signing flows in this phase.

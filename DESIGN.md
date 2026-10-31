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

Desktop uses a persistent 248px sidebar and a fluid content region. Tablet narrows the sidebar and changes three-column summaries to two columns. Mobile uses an overlay navigation drawer with Escape, focus cycling, and a backdrop; data tables scroll horizontally. Reduced-motion preferences disable transitions. All interactive controls use native buttons, links, search input, or select semantics and visible focus rings.

## Shared component owners

`ui.tsx` owns exact wei formatting, status badges, transaction lifecycle, proof status, empty/loading/error presentation, explorer links, wallet security notice, and financial table markup. `activity-table.tsx` owns text/status filtering. `wallet-status.tsx` reads only public account/chain state from an injected EVM provider. `app-shell.tsx` owns route navigation and theme. `security-dialog.tsx` owns the native modal pattern. There are no transaction signing flows in this phase.

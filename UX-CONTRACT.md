# BISECT web interaction contract

## Canonical UI Map

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

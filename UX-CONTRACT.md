# BISECT web interaction contract

## Canonical UI Map

| Capability     | Canonical owner                | Source of truth                    | Allowed variants | Verification                                  |
| -------------- | ------------------------------ | ---------------------------------- | ---------------- | --------------------------------------------- |
| Select/Listbox | Native activity status filter  | This contract and browser platform | Native select    | E2E accessible-name and disabled-state checks |
| Scrollbar      | Global browser scroll behavior | `DESIGN.md` and global CSS         | Native scrollbar | Narrow viewport table scroll E2E              |

- **Navigation:** Route links own the seven top-level destinations. Current route uses `aria-current="page"`. At mobile sizes the sidebar is an overlay; Escape, backdrop, and route selection close it. Focus enters the drawer and wraps while open.
- **Theme:** The header button changes the document theme and stores only `bisect-theme` (`light` or `dark`) in browser local storage. It stores no wallet or financial data.
- **Wallet:** Connect asks the injected provider for account access. It never requests signing on load or exposes a key field. Account and chain change events update visible status. Base Sepolia chain ID 84532 is the only displayed target. Missing provider and rejected connection show a status message.
- **Financial data:** Unknown values render as unavailable, never zero. Wallet balance, locked bond liabilities, and withdrawable credits have separate labels. Activity rows are shown only when real records are supplied. A missing deployment/indexer is explained in place.
- **Lifecycle:** Pending, confirmed, and reverted are distinct labels. Explorer links are rendered only for a validated transaction hash and point to Base Sepolia. Proof state defaults to “Not checked.”
- **Filtering:** The activity table owns its search and status filters. Clearing filters restores the original dataset. An empty dataset and a no-match result have separate messages.
- **Dialog:** The browser-native dialog owns modal focus, Escape behavior, and restoration for wallet safety information. No destructive or financial action is offered.
- **Responsive data:** Financial tables retain their column relationships and scroll horizontally on narrow screens. Controls remain available above the table.
- **Accessibility:** Native control semantics, explicit labels, live status feedback, keyboard focus visibility, reduced motion, and a skip link are required. Route content has one page heading and labeled navigation.

# Obsidian Sync Go — Sync Log Design Contract

## 1. Product Character

The sync log is an operational Obsidian side panel. Its visual contract is the locally installed Fast Note Sync log view (`fast-note-sync`), adapted only where Sync Go's data model differs. It must feel native, compact, information-dense, and immediately scannable rather than decorative.

## 2. Reference and Scope

- Reference implementation: `C:/Users/Caesar/notecode/婷的简历/.obsidian/plugins/fast-note-sync/main.js` and `styles.css`.
- Exact reference structures: compact header, desktop menu/mobile filter panel, operation rows, summary rows, path actions, and pagination.
- Sync Go retains its own persisted log records, live refresh events, status phases, and operation decisions.
- No Fast Note Sync networking, storage, branding, or business logic is copied.

## 3. Tokens

Use Obsidian theme variables for surfaces and text:

- `--background-primary`: panel background.
- `--background-secondary`: operation rows and filter surface.
- `--background-secondary-alt`: summary surface.
- `--background-modifier-border`: borders.
- `--background-modifier-border-faint`: internal separators.
- `--background-modifier-hover`: interactive hover/selected background.
- `--text-normal`, `--text-muted`, `--text-faint`: text hierarchy.
- `--text-success`, `--text-error`, `--text-warning`: operation state.
- `--interactive-accent`, `--interactive-accent-rgb`: active controls.

Semantic fixed colors inherited from the reference:

- Note `#08b94e`; attachment `#7c4dff`; folder `#1e88e5`; config `#ff8a33`; other `#6367ff`.
- Upload `#ff8c00`; download `#007bff`; delete `#f44336`.

Geometry tokens:

- Panel padding `10px`.
- Header padding `8px 0`, bottom gap `8px`.
- Row padding `8px`, row gap `4px`, radius `4px`.
- Category/direction rails `4px`.
- Filter radius `8px`, padding `12px`, group gap `16px`.
- Pagination control `28px`, radius `6px`, gap `16px`.

## 4. Typography

- Header: Obsidian `h3`, zero margin.
- Operation header and status: `12px`.
- Path and message: `11px`.
- Direction tag and progress: `10px`.
- Use Obsidian UI font; monospace only for symbolic direction glyph metrics.
- Chinese labels must remain on one line when space permits; action text truncates before status controls.

## 5. Reusable Primitives

- `SyncLogHeader`: title, live connection/sync indicator, settings, filter, clear, optional close.
- `SyncLogFilterMenu`: desktop Obsidian menu with category, direction, failed-only, and reset selections.
- `SyncLogFilterPanel`: touch-friendly inline equivalent for mobile.
- `SyncLogItem`: time, action, direction tag, state, path action, optional message.
- `SyncSummaryCard`: run-level result and counts grouped by note, attachment, config, folder, and other.
- `SyncLogPagination`: first, previous, current/total, next, last.

Required states: idle, pending, success, error, selected filter, disabled pagination, hover/focus path actions, empty list, and live operation.

## 6. Layout and Responsive Rules

- The panel owns vertical scrolling; header, optional filter, and pagination remain outside the list scroll area.
- Operation headers are single-line flex rows. The action label flexes and ellipsizes; time and status never shrink.
- Paths wrap anywhere and reveal copy/open controls on hover or keyboard focus.
- Desktop filter uses an Obsidian context menu. Mobile filter expands inline with 32px minimum chips and 36px footer controls.
- Both docked view and modal use the same renderer and tokens.

## 7. Interaction and Motion

- Filter panel enters with `opacity` and `translateY` over `200ms ease`.
- Chips and pagination controls provide pressed feedback; pagination hover uses a one-pixel translate.
- Pending status pulses opacity only. All motion must stop under `prefers-reduced-motion: reduce`.
- Path click opens local notes/attachments when present; deletion/config paths copy instead. Explicit icons expose both actions where applicable.
- Live refresh preserves current filters and page, except a filter change resets to page one.

## 8. Accessibility, Verification, and Accepted Debt

- Icon-only buttons require localized `aria-label` and native focus behavior.
- Color is never the sole signal: category/direction labels and success/error glyphs accompany rails.
- Minimum touch targets apply to mobile filters; desktop controls follow the 28px reference.
- Verify light/dark themes, narrow dock width, modal width, long CJK paths, empty results, pending state, and all pagination boundaries.
- Accepted debt: Sync Go stores run-level success rather than per-operation completion, so persisted operation rows inherit the run result. Live rows may show pending until the run settles.

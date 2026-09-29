# Validation record

Updated September 29, 2026; checked locally with Node 24.14.0.

## Automated checks

`npm test` runs 46 tests without downloading dependencies:

- Next-bar entry timing and spread, slippage, commission, and cash accounting.
- Round-trip reconciliation of cash, equity, and realized P&L.
- Approval requirement, one-use IDs, expiry, and price-drift rejection.
- Duplicate-symbol prevention; missing quotes and stale data rejected.
- Position, gross exposure, risk budget, cash, and liquidity limits.
- Revalidation after settings changes; atomic invalid-settings rejection.
- Emergency stop preserves holdings while blocking entries.
- Zero-volume exit deferral and partial-exit accounting; flatten does not generate replacement entries.
- Daily loss halt and liquidation request.
- End-session exit attempts and residual positions at dataset exhaustion.
- Deterministic demo data and OHLCV/duplicate validation.
- Signals unaffected by later bars.
- Training selection unaffected by changed held-out data.
- HTTP workflow, cross-origin blocking, request validation, saved state, safe restart, export, and invalid import rejection in an isolated temporary directory.

## Browser checks

Verified in the Codex browser at `http://127.0.0.1:4317`:

- Dashboard rendered, charts and watchlist visible, no browser warnings/errors captured.
- Approved a demo suggestion, advanced one bar, and observed the resulting shares and cash change.
- Switched to automatic mode and advanced twelve bars, producing fills and risk-limited positions.
- Saved a modified gross exposure limit and observed the risk monitor update.
- Ran the historical comparison and checked all three baseline metric rows and the training/held-out split.
- Activated emergency stop, confirmed queued entries disappeared, then flattened the demo holdings and verified zero open positions.
- Returned to review-first mode with replay paused.
- Checked a 390 × 844 viewport, fixed table-related page overflow, and confirmed document width no longer exceeds the viewport. Tables scroll within their panels. Restored the normal browser viewport.

## Limits of validation

These checks verify implemented behavior, not profitability or equivalence to a real broker. A previous authenticated paper connection returned account, clock and quote data. No actual broker execution or authenticated historical download has been observed; the current session needs credentials again. Provider tests use clearly identified injected responses. Calendar filtering and partial-fill/order handling are contract-tested. No language model, public deployment, or comprehensive corporate-action handling has been validated. Execution assumptions and missing features are documented in README.md and in the application.



## Real-data and external paper integration — September 28, 2026

The full 34-test suite passes. Added checks cover fixed paper/data hosts (live URLs rejected), redirects blocked, credential-safe errors, historical pagination, partial-download rejection, holiday and early-close filtering, unfinished bars, stale/future/crossed quotes, account/clock freshness, cash reservations, gross exposure, daily losses, durable intent-before-submit behavior, approval deduplication, uncertain network outcomes, restart behavior, remote partial-fill reconciliation, external-order ownership, external-position conflicts, stop/start races, app-only flatten, current-market automatic/approval signal polling, missing-credential HTTP flows, malformed-request redaction, and one-process-per-account-directory locking.

Browser inspection confirmed the separate Live paper account screen, empty/unconnected state, disabled entry controls before setup, password-type local key fields, real-history date/download controls, and clear separation from replay. The new page was inspected at a 390-pixel mobile width with no document overflow, then restored to desktop size. No browser warnings or errors were recorded during the final screen inspection.

The September 28 automated build did not verify the connected success path against Alpaca itself; the user subsequently connected successfully. No fabricated account values or injected test quotes are placed into the running app. The user's next step is documented in PAPER_SETUP.md.

## Dated allocation test — September 29, 2026

All 46 tests pass. Added coverage includes the $2,000 cap against a $100,000 broker account; partial-fill cash reservations; realized/unrealized P&L; a $40 loss trigger; future-day and next-day entry exclusion; DST and early-close calendar times; offline preparation followed by authenticated arming; holiday/expired/insufficient-cash rejection; unresolved-holding protection; stop/arm races; full automatic buy/fill/sell/complete lifecycle; missed-close attention status; and recovery from transient provider failures without retrying uncertain submissions.

The running local API has a saved September 30 allocation of $2,000 with no submitted session orders. The browser shows CONNECT TO ARM and a password-based connection form. This is not an armed, authenticated success claim: credentials must be supplied locally. The Windows background launcher is included.

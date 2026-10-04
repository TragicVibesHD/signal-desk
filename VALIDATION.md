# Validation record

Updated October 3, 2026; checked locally with Node 24.14.0.

## Automated checks

Current version 5 suite: **91 tests pass**. Historical entries below record the checks run for earlier versions.

October 3 audit: ten added regressions cover exact executable-limit sizing, rounded-stop risk, active reservations, liquidity caps, same-bar recovery from temporary quote/spread failures, fixed expiry, decline/uncertain-order deduplication, signal-close drift, entry-boundary revalidation and full-precision profit reconciliation. The research test also verifies that completed-trade realized P&L matches total P&L for flat runs in every strategy and cost scenario.

Refreshed the active VS Code server and verified its process parent is Code.exe. The application generated a version 5 report from the explicitly labeled synthetic dataset, retained the completed flat paper session and $1.20 P&L, and reported no uncertain orders. Browser logs contained no warnings/errors; the normal viewport had no document overflow. Credentials remain disconnected; no authenticated new brackets or real-history performance were verified in this audit.

`npm test` runs 62 tests without downloading dependencies:

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

These checks verify behavior, not profitability or equivalence to a real broker. The persisted September 30 authenticated paper ledger now includes actual paper orders. No authenticated historical download was available during this upgrade; the current server needs credentials again. Provider tests use clearly identified injected responses. Calendar filtering and partial-fill/order handling are contract-tested. No language model, public deployment, or comprehensive corporate-action handling has been validated. Execution assumptions and missing features are documented in README.md and in the application.



## Real-data and external paper integration — September 28, 2026

The full 34-test suite passes. Added checks cover fixed paper/data hosts (live URLs rejected), redirects blocked, credential-safe errors, historical pagination, partial-download rejection, holiday and early-close filtering, unfinished bars, stale/future/crossed quotes, account/clock freshness, cash reservations, gross exposure, daily losses, durable intent-before-submit behavior, approval deduplication, uncertain network outcomes, restart behavior, remote partial-fill reconciliation, external-order ownership, external-position conflicts, stop/start races, app-only flatten, current-market automatic/approval signal polling, missing-credential HTTP flows, malformed-request redaction, and one-process-per-account-directory locking.

Browser inspection confirmed the separate Live paper account screen, empty/unconnected state, disabled entry controls before setup, password-type local key fields, real-history date/download controls, and clear separation from replay. The new page was inspected at a 390-pixel mobile width with no document overflow, then restored to desktop size. No browser warnings or errors were recorded during the final screen inspection.

The September 28 automated build did not verify the connected success path against Alpaca itself; the user subsequently connected successfully. No fabricated account values or injected test quotes are placed into the running app. The user's next step is documented in PAPER_SETUP.md.

## Dated allocation test — September 29, 2026

All 46 tests pass. Added coverage includes the $2,000 cap against a $100,000 broker account; partial-fill cash reservations; realized/unrealized P&L; a $40 loss trigger; future-day and next-day entry exclusion; DST and early-close calendar times; offline preparation followed by authenticated arming; holiday/expired/insufficient-cash rejection; unresolved-holding protection; stop/arm races; full automatic buy/fill/sell/complete lifecycle; missed-close attention status; and recovery from transient provider failures without retrying uncertain submissions.

The running local API has a saved September 30 allocation of $2,000 with no submitted session orders. The browser shows CONNECT TO ARM and a password-based connection form. This is not an armed, authenticated success claim: credentials must be supplied locally. The Windows background launcher is included.

## Strategy and evaluation upgrade — October 3, 2026

All 56 tests pass. New cases check corrected opening warmup, missing opening bars, below-VWAP entry exclusion, 14-session volume gating, rising opening candles, activity ranking under scarce slots, cooldown enforcement at submission, frozen experimental profiles, preceding-session paper downloads, duplicate prevention, matched $2,000 evaluation, cost stress, synthetic evidence rejection, and development selections unaffected by changed final-test prices and volumes. Historical downloads cap their endpoint at the current time.

The stored September 30 authenticated paper ledger reconciles to $1.20 profit on a $2,000 allocation, five buy / five sell orders, and no remaining positions. This is one observed paper session, before fees. No real historical dataset was saved, and the prior server had stopped with credentials lost from memory. Profit improvement from version 2 is not established. Tests use fixture data, never the broker account.

The one-click real-data comparison downloads the allowed historical window and evaluates it without changing the saved paper session or replay holdings. Its provider pipeline is tested with fixture data; missing credentials are rejected by the HTTP route. Browser inspection verified the five comparison rows, cost-stress column, walk-forward table, failed synthetic evidence checks, experimental profile selector, preserved completed-session results and next-weekday date suggestion. No real orders were sent during verification.

## Scalping profile — October 3, 2026

All 62 tests pass. Added checks verify $1,400 entries against a $2,000 allocation rather than broker buying power, rejection above $1,500, unreserved cash, one-position limit, wide-spread and low-volume rejection, eight-entry cap, five-minute cooldown, $40 session-loss protection, stop/target/15-minute exit submissions, consecutive-bar signal requirements, volume confirmation, and research using the actual scalp profile. These are fixture and synthetic checks; no authenticated scalp performance is established.

Browser verification shows all six comparison rows with their actual position / stop / target settings, rejects synthetic performance as evidence, and exposes the scalp profile in dated paper setup. The completed September 30 result remains unchanged. No browser warnings or errors or document overflow were observed. The updated server runs under the VS Code debugger; the current broker connection is unconfigured, entries are stopped, and no scalp session has been armed. No broker orders were placed during verification.

## Broker protection and standards — October 3, 2026

All 81 tests pass. New coverage verifies durable bracket requests and quote capture; nested leg adoption/deduplication; target and resized-stop fills; cash/P&L/ownership reconciliation; cancellation waiting; fill-versus-cancel races; restart with a pending exit; no cancellation/resubmission churn for a pending market sell; partially filled entries without active protection; preserved protection after stopping entries; accepted brackets with lost responses; external order isolation; double-fill attention; missing-parent recovery; completed-trade metrics after partial exits and fees; data gaps/off-grid/calendar omissions; whole-share passive benchmark costs; conservative stop-first OHLC modeling; adverse gaps; prior-bar liquidity without future execution volume; and fixed allocation/daily loss caps after accumulated gains. A pending exit blocks fresh buys until reconciliation. The HTTP suite verifies the new UI module is served.

Browser inspection verifies operational checks, preserved $1.20 completed paper results, legacy slippage shown as unavailable, all six research rows with completed-trade/concentration metrics, data coverage and cash/basket benchmarks, and the sourced established-system comparison. Synthetic prices still fail the evidence screen. The final browser inspection records no warnings or errors and no document overflow. The updated server remains in the VS Code debugger. Credentials are unconfigured, entries are stopped, and no external paper orders were placed during this upgrade. Authenticated bracket success and real-data profitability are not claimed.

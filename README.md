# Signal Desk

Real five-minute history can now be downloaded without API keys from **Data & connections → Download public stock history**. The current local replay contains 60 sessions for six stocks, uses $2,000, and has a saved real-data comparison. See [REAL_DATA.md](REAL_DATA.md) for coverage, limitations and repeatable setup. Alpaca credentials remain necessary for current-market paper orders and IEX history.

A local U.S. stock **paper-trading research application** with two separate workspaces: credential-free historical replay, and an optional Alpaca paper account using actual market data. No order can reach a real-money trading endpoint. The bundled prices are deterministic synthetic data; actual Alpaca data and paper execution require your own paper API keys. No paid service, external package, or AI key is required by the app.

**[Current bot comparison and standards](BOT_COMPARISON.md)** — engineering audit, broker protection, research assumptions and remaining evidence gaps. The September 30 paper test returned $1.20 on $2,000 before fees. New sessions require local paper credentials. General setup: [Paper account and real data](PAPER_SETUP.md).

## Launch

To run inside VS Code, open this project folder and select **Run and Debug → Signal Desk server → Start Debugging (F5)**. The server runs under VS Code and prints its address in the Debug Console. Keep that VS Code window and run session open. Starting it requires that another server is not already using the same account directory. This is independent of the Codex chat/browser session; closing VS Code or stopping debugging stops the server. Paper credentials entered in the app must be re-entered after a server restart.

Requires Node.js 22 or later (built and checked with Node 24.14.0). On Windows, double-click **Start Signal Desk.cmd** to start the background server and open the paper page. It reuses the running server if one already exists. Alternatively, run in a terminal:

```powershell
cd 'C:\w\Personal Projects\Trading Bot'
npm start
```

Open **http://127.0.0.1:4317**. Keep the server running; Ctrl+C stops it. If the preview from this build is already running, use that URL instead of starting a second copy. No `npm install` is needed. Set `$env:PORT='4318'` before launch to use a different port. Optional `DATA_DIR` selects a different account storage directory.

```powershell
npm test
```

## First session

1. The app starts paused with $100,000 simulated cash and 12 completed demo bars.
2. In **Review first**, approve a suggested entry, then select **Next bar** to attempt execution. Suggestions expire after 90 seconds or three subsequent bars. Approvals do not guarantee fills.
3. **Automatic** enables automatic simulated entries. **Start replay** advances one data bar every two seconds; **+12 bars** advances a batch. Pausing also pauses exits.
4. Review positions, cash, and reasons in **Trade history**. Use **Risk controls** to change exposure, loss, stop, cost, and liquidity settings.
5. **Strategy lab → Run historical comparison** compares three corrected baselines, active-opening and scalping experiments, and the combined baseline with a $2,000 budget. Development walk-forward checks and a final 30% holdout report cost stress, daily returns, drawdown and evidence gaps.
6. **Emergency stop** pauses replay, blocks entries, and cancels suggestions. It does not close holdings. **Flatten & advance** attempts next-bar exits; repeat if partial fills leave shares open.

Browser testing during development may leave a small simulated trade and a saved comparison in the demo account. Use **Data & connections → Reset to synthetic demo** for a clean account. Reset requires typing `RESET`; export first if you want to retain the ledger.

## What is implemented

- Responsive dashboard, equity curve, six-stock watchlist, cash account, positions, approvals, fills, rule explanations, risk controls, and activity log.
- Three fixed long-only baselines plus volume-filtered opening breakout and larger-cash scalping experiments. Frozen dated profiles determine position size, stops, targets and time limits.
- Server-side cash, gross exposure, per-position, count, daily loss, and stop-distance risk budgets. No AI component can bypass these checks.
- Duplicate-symbol entry prevention, one-use approval IDs, expiry, price-drift checks, missing-bar rejection, wall-clock stale-data checks, and restart cancellation of unfilled approvals.
- Next-bar execution with adverse half-spread, slippage, commission, a volume participation cap, and partial exits.
- Local persistence via temporary-file replacement. Account state survives restart; the engine always restarts paused. Imported data is saved separately.
- JSON import/export; deterministic backtests showing net returns, mark-to-market drawdown, win rate, payoff, exit-fill count, estimated costs, and residual positions.
- Optional real Alpaca IEX historical downloads, paginated completely, filtered to the exchange calendar including early closes, with source/adjustment metadata and backup-before-load behavior.
- Separate current-market paper account with approval/automatic modes, account and order reconciliation, fresh quotes, reserved-cash risk checks, durable client order IDs, partial-fill tracking, cancellation and app-position flattening.
- Entry requests are capped limit orders; exits are broker paper market orders. Application-managed exits continue while connected even with new entries stopped. New dated sessions request broker-held stop/target brackets and reconcile their child fills. Legacy sessions retain application-managed stops. Time and session-close exits require the server/computer/network to remain running.

## Data import

In **Data & connections**, import a JSON object:

```json
{
  "label": "Your licensed provider / interval / date range",
  "bars": [
    {"symbol":"AAPL","timestamp":"2025-09-02T13:30:00Z","open":225,"high":226,"low":224,"close":225.5,"volume":50000}
  ]
}
```

Supply **100–250,000 bars**, no more than 40 MB, with at least 12 distinct timestamps. Historical evaluation needs six or more sessions. Timestamps represent bar starts, must contain a timezone, and must fall within 09:30–16:00 America/New_York. Five-minute bars with a consistent interval are recommended. The strategy means are measured in bars, so changing interval changes the rules' horizon.

Manual import checks OHLC relationships, finite positive prices, nonnegative volume, duplicate symbol/timestamp pairs, and timestamp formatting. Source authenticity, U.S. stock eligibility, licensing, exchange calendar/half-days, adjustments, and survivorship bias are **not verified for user-supplied files**. No authentic historical intraday dataset is bundled. The optional Alpaca downloader provides actual five-minute IEX bars with split adjustment and exchange-calendar filtering. Downloads require authentication and your data entitlement; see PAPER_SETUP.md. Loading either source backs up the previous replay account/dataset and resets the replay balance; it is blocked while replay positions remain open. External paper positions are unaffected.

## Research and execution assumptions

Signals consume completed bars only, then execute at a later bar's open. Approval revalidation uses that open, current account limits, and a maximum 0.5% move from the suggestion reference. New entries stop at 15:30 ET. The baseline opening range requires all six first-30-minute bars; it no longer waits for twelve total bars. Breakout entries require price above VWAP. Reversion and momentum require twelve bars. The active-opening experiment uses the first five-minute bar and opening volume compared with 14 preceding sessions. A ten-minute cooldown follows exits. VWAP uses cumulative typical-price × volume within the session. When multiple strategies qualify, the first enabled strategy owns the entry. Activity candidates compete by descending relative opening volume; other baselines retain their existing symbol priority.

In replay, stops and targets are **completed-close thresholds**, not intrabar stop orders. A gap or missing data can produce a loss exceeding the configured risk budget. Position sizing ignores the possibility of such gaps. All positions have a 60-minute time exit; session-close attempts begin ten minutes before the session close (15:50 ET on normal days). The Alpaca downloader supplies early-close times; raw imports default to a 16:00 ET close unless a validated `sessionCloseMinute` is included. Zero volume, missing symbol bars, and dataset exhaustion may leave residual holdings. A later session attempts to close carried positions. Quotes for absent symbols remain at their last observed value, so equity can be stale. Current-market paper exits instead use quote thresholds and the broker clock; see PAPER_SETUP.md for their separate execution model.

Legacy interactive replay volume participation uses the execution bar's final volume as an approximate liquidity constraint. That volume is not known at the open in reality: fills at the open with full-bar liquidity are an optimistic simplification, not an order-book replay. Future bars never feed signal generation or training selection. Version 4 research instead uses prior completed-bar volume and conservative OHLC bracket simulation (stop first for ambiguous touches; adverse opening gaps exceed stops). These remain approximate fill models. An entry exceeding the volume cap is rejected; exits can fill partially. Spread/slippage are fixed and can be stress-tested in settings. No market impact, auction allocation, bid/ask data, queue priority, halts, regulatory fees, settlement restrictions, margin, shorts, taxes, or dividends are modeled. This is a cash ledger without cash-settlement timing, not a regulatory brokerage account simulation.

Evaluation starts independent development, final-test and cost-stress accounts with the chosen budget ($2,000 by default), matching dated-session position and loss limits. Each starts without holdings, with prior sessions supplying volume context only. Three expanding development folds select using preceding data and evaluate the next period. The final 30% never participates in selection; results stay in fixed strategy order. No parameters are optimized. The evidence screen is a heuristic for further paper testing, not statistical proof. Repeated changes after viewing the final test invalidate its independence. See [RESEARCH.md](RESEARCH.md) for methods, sources and the next test.

Return includes residual holdings marked to their last price; no fictitious terminal liquidation is inserted. Drawdown uses end-of-bar account equity. Research win rate/payoff/profit factor use completed position cycles, aggregating partial exits and recorded entry/exit costs. Legacy interactive replay statistics use exit slices. Costs are commissions plus an estimate of spread/slippage already embedded in fills; they are not deducted twice. The UI displays the latest 200 ledger rows; persistence/export retains the latest 2,000 fills, 2,500 equity observations, 300 suggestions, and 150 log entries. Realized trade history remains in state. Historical evaluation retains its full independent execution/equity history, so the replay display caps do not truncate evaluation metrics. USD internal arithmetic uses floating point; presentation rounds to cents. This is not an audited financial ledger.

## Primary references reviewed September 27, 2026

- [QuantConnect opening-range breakout boot camp](https://www.quantconnect.com/forum/discussion/10724/boot-camp-5-opening-range-breakout-all-text-and-code/): reference for the strategy family. This app implements its own deliberately simple variant.
- [QuantConnect intraday VWAP documentation](https://www.quantconnect.com/docs/v2/writing-algorithms/indicators/supported-indicators/intraday-vwap): reference for a session VWAP indicator. Reversion thresholds and moving-average entry rules here are hypotheses, not claims validated by that documentation.
- [Alpaca paper-trading documentation](https://docs.alpaca.markets/us/docs/paper-trading): describes differences between simulated and live execution, including missing market impact and queue effects. The optional adapter is implemented; simulation limitations apply even after authenticated paper observation.

The synthetic generator has six familiar U.S. stock labels but artificial prices. Any favorable result reflects the generated process, not those companies or a proven tradable edge. There is no honest basis yet to recommend one baseline for real trading.

## Architecture and extension path

- `engine.mjs`: pure account state transitions, normalization, deterministic data generator, signal rules and execution/risk functions. `research.mjs` runs chronological evaluation, volume warmup, walk-forward selection, cost stress and evidence screening. `prepare()` is the data boundary: adapters should deliver the documented OHLCV shape.
- `alpaca.mjs`: fixed paper/data hosts, credential-private HTTP client, paginated IEX bars, exchange-calendar filtering, assets, quotes, clock, and order operations. No live endpoint can be configured.
- `paper.mjs`: separate current-market account, durable order intents, broker reconciliation, risk/reservation checks, signal polling, ownership checks, approval/automatic entries, and independent protective exits.
- `profiles.mjs`: frozen dated-session profiles, including the larger-position paper scalping experiment. The scalp profile permits one cash position up to 75% of allocation, a 0.4% stop trigger, 0.8% target, 15-minute holding limit, five-minute cooldown, eight daily filled entries and a 10-bps spread ceiling. It retains the 2% session-loss trigger and does not use broker margin. See RESEARCH.md for assumptions and limitations.
- `server.mjs`: loopback HTTP API, replay timer, state persistence, and static file serving. It binds only to 127.0.0.1, checks Host and browser Origin, and accepts mutations only as JSON. There is no authentication or multi-user support; do not expose this server publicly.
- `public/`: dependency-free browser UI. Explanations are templates generated from actual rules. No model is called.
- `tests/`: engine invariants, provider-adapter and paper-account tests using explicit injected responses, and an isolated HTTP/persistence workflow using a temporary account directory. Tests never connect to your provider account.
- `data/`: private runtime files, ignored by source control. Back up this directory while the server is stopped.

The replay simulator and asynchronous external account are intentionally separate. The Alpaca adapter is implemented and contract-tested; one authenticated dated paper session completed. A future provider should preserve the same paper-only URL allowlist, asynchronous submission/reconciliation model, stable client IDs, account identity binding, fresh-data rules, and pre-trade limits. User-imported/replayed data must never submit external orders. Real-money trading remains outside this project's scope.

Account creation, account eligibility, and external credentials require the user. App authentication, multi-user access, public hosting, commercial deployment, full corporate-action/event handling, regulatory cash-settlement modeling and calibrated order-book execution are not implemented. New dated-session paper brackets are fixture-tested; authenticated bracket behavior remains to be observed. Next research work should use actual licensed intraday data, reserve an untouched final test period across market regimes, stress execution costs, and observe the external paper account before drawing performance conclusions. IEX is single-exchange data; its quotes/volume do not represent the entire U.S. market.

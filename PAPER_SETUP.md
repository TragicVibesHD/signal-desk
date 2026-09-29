# Connect real data and an Alpaca paper account

For the saved $2,000 one-day automatic test, follow [TOMORROW.md](TOMORROW.md). The Alpaca paper connection was previously successful, but server-memory keys were lost when that server stopped. Authenticated external order execution has not yet been observed. Development checks use explicit provider test doubles; they are never displayed as live data.

## 1. Create the paper account

1. Visit [Alpaca](https://app.alpaca.markets/signup) and complete its account steps yourself.
2. Choose the **Paper Trading** workspace. Generate a **paper API key and secret** there. Account screens may change; follow Alpaca's [paper-trading documentation](https://docs.alpaca.markets/us/docs/paper-trading).
3. Use a dedicated paper account for Signal Desk. Avoid manual trades or other bots in it, so fills and position ownership can be reconciled reliably.

This app does not need a funded real-money brokerage account, does not enroll you in paid data, and cannot connect to Alpaca's live-trading endpoint. Alpaca determines account availability and data entitlements. Never paste API secrets into a chat, issue, screenshot, or source-control commit.

## 2. Connect locally

With the server running, open [Signal Desk](http://127.0.0.1:4317), select **Live paper account**, and enter the paper key and secret. Select **Connect paper account**.

Form-entered keys are held only in server memory. They are sent only to the fixed Alpaca paper API and market-data API. They are not returned in browser state, persisted account JSON, or ledger exports. You must reconnect after restarting the server. A saved session marked for automatic arming is validated and armed when you connect; the button explicitly says **Connect & arm saved session**. Other sessions stay stopped.

Optional persistence: copy `.env.example` to `.env.local` in the project and fill in these two values locally:

```text
ALPACA_PAPER_KEY=your-paper-key
ALPACA_PAPER_SECRET=your-paper-secret
```

Restart the server, then select **Connect paper account** with both form fields blank. `.env.local` is ignored by Git but is **plain text on your computer**, not an encrypted credential vault. Protect that file and do not share it. The app deliberately does not connect or enable entries automatically just because the file exists.

Expected result: actual broker paper equity/cash, market status, reconciliation time, and current IEX quotes appear. Closed-market quotes can be stale; entries will remain blocked until regular trading hours and fresh data are available.

## 3. Download historical market data

Open **Data & connections**. Choose a date range covering at least six trading sessions and at most 120 calendar days, then select **Download real data**.

- Six stocks: AAPL, MSFT, NVDA, AMZN, META, GOOGL.
- Five-minute bars, IEX feed, split-adjusted historical prices.
- All provider pages must finish; partial downloads are not loaded.
- The broker's exchange calendar removes holidays and bars outside regular sessions, including early closes. Incomplete bars are excluded.
- IEX is one exchange, not consolidated SIP coverage. Gaps and thin volume can materially affect these intraday strategies. No synthetic bars are inserted to fill missing periods.

When the download finishes, select **Load into replay & research**. The previous replay account/dataset is copied into `data/backups/`. The replay account resets, while risk settings and selected strategies are retained. The external broker account is unaffected. The dashboard will show **REAL DATA · REPLAY** with its provider and dates.

Run **Strategy lab → Run historical comparison**. Results remain historical simulations, not live fills or proof of future profitability. Keep an untouched final test period and test across regimes before choosing a baseline. A current list of surviving companies introduces universe-selection bias.

## 4. Observe current-market paper trading

Without a dated session configured, in **Live paper account**, start with **Enable review-first entries**. Leave the app running during regular U.S. market hours. It downloads completed five-minute bars, applies the selected strategy rules, and shows expiring current-market suggestions. Approve one to attempt a broker paper order.

**Enable automatic entries** submits eligible suggestions without individual approval. Both modes use server-side limits. Dated sessions use their frozen budget and preset, independent of replay settings; a session allocation is a fill-based cash ledger rather than a reset of the broker account balance. Orders use stable client IDs and are written locally before submission. A timeout creates an uncertain state that blocks further entries; the app looks up the existing order rather than resubmitting.

Entry checks include current account/clock/quote freshness, an active tradable U.S. stock, account restrictions, cash/buying power, pending-order reservations, position count, exposure, per-entry stop-distance risk, daily loss, last completed bar volume, a 0.5% quote-spread limit, and a 0.5% move from the suggestion reference. Quotes must be at most 30 seconds old. Signal bars must have completed within 90 seconds. Entries are whole-share, unlevered, regular-session limit orders capped 0.1% above the observed ask; this may mean they do not fill. Unfilled app entries are cancelled after 90 seconds. No new entries are submitted within 30 minutes of the broker-reported close.

The broker is authoritative for acceptance, rejection, partial fills, fills, and cancellation. The live-paper ledger does not invent simulated executions or fee amounts. It uses actual broker responses. The local replay ledger remains separate.

## 5. Stops, exits, and recovery

**Stop paper entries** blocks new submissions and requests cancellation of app-owned buy orders. It does not immediately liquidate holdings. **Flatten app positions** also attempts market exits for shares attributable to this app. Orders belonging to another client are not cancelled. Holdings that differ from app fill history block entries and automatic exits for the affected stock until reconciled.

Protective exits run every approximately ten seconds while connected, independently of whether new entries are enabled. Quote-based stops/targets, a 60-minute time limit, strategy exits, the daily-loss guard, and a close attempt ten minutes before the exchange close are implemented. Early closes use Alpaca's actual clock.

**These are application-managed exits, not broker-held stop orders.** Keep the computer, server, network, and paper connection running. Closing the server or losing connectivity stops monitoring. A closed market, stale quote, halt, rejection, missing data, or partial fill can prevent closure. A loss can exceed the configured stop-distance budget. Inspect and manage remaining orders/positions directly in the Alpaca paper dashboard if needed.

On restart: reconnect to reconcile. A previously armed dated session can automatically resume only within its validated entry window and after risk checks. Manually stopped sessions remain stopped. The monitor attempts to cancel outstanding app buy orders after connection. Partially filled shares remain tracked and managed. A submission that is still missing or uncertain is never automatically retried; inspect its client order ID in the export and broker dashboard. If the broker cannot resolve it, keep entries stopped and preserve the state for investigation. There is deliberately no “ignore uncertainty and trade anyway” button.

Resetting the local synthetic demo does not reset or clear the external account. A workspace is bound to one broker account ID; changing accounts requires a separate `DATA_DIR`, after accounting for all old orders and positions. Do not delete state while broker activity remains unresolved.

## What remains unverified until you connect

- Authentication and entitlements after reconnecting (the prior connection worked).
- Real historical downloads and data quality for the chosen dates.
- Live quote availability and latency during market hours.
- Actual paper acceptance, fills, partial fills, rejection, and cancellation.

The adapter has automated contract/behavior tests using injected responses. That is useful implementation evidence, but it is not a substitute for observing a real paper session.

Sources checked September 28, 2026: [Alpaca historical bars](https://docs.alpaca.markets/us/reference/stockbars), [latest quotes](https://docs.alpaca.markets/us/reference/stocklatestquotes-1), [orders](https://docs.alpaca.markets/us/docs/working-with-orders), and [market-data coverage](https://docs.alpaca.markets/us/docs/market-data-faq).

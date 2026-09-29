# September 30, 2026 — $2,000 automatic paper test

The local server is running and this session is saved. **It is not armed until you connect your Alpaca paper keys.** The previous server stopped and its memory-only keys were lost.

1. Open [Signal Desk — Live paper account](http://127.0.0.1:4317/#paper).
2. Enter your existing **paper** API key and secret in the connection form. Keep secrets out of chat. Click **Connect & arm saved session**.
3. Check the green **ARMED · WAITING FOR OPEN** status, the **September 30** date, and **$2,000** budget. A connection or calendar error means the session is not armed; the app displays the reason.
4. Leave the PC plugged in, awake and connected to the internet through the close. Sleep on AC power was already disabled when checked. Do not reboot, stop the server, or disconnect the account. The browser can be closed: the server runs in the background.

The app checks Alpaca's exchange calendar when connecting. A normal session is 9:30 a.m.–4:00 p.m. Eastern, also 9:30 a.m.–4:00 p.m. in La Paz on this date. New entries end at 3:30 p.m.; closing attempts begin at 3:50 p.m. The app cannot enter new positions on a following date without a newly armed session. If a position cannot close, the page shows that it needs attention and continues attempting liquidation during open-market monitoring.

## What runs automatically

- Current IEX quotes, broker reconciliation and exit checks approximately every ten seconds; completed five-minute bars for strategy signals.
- Opening-range breakout, VWAP reversion and momentum baselines, in that priority order. These are test strategies, not validated profit forecasts.
- Long-only, whole-share paper orders, up to four stocks. Maximum $500 per stock and $2,000 total allocation; both scale down after losses. Gains do not expand the original capital cap. No use of the broker's extra $98,000 for sizing.
- 0.5% budgeted risk at the stop distance; a 1% stop threshold, 2% target and 60-minute time exit. A $40 session loss triggers entry suspension and liquidation attempts. Gaps, outages and execution failures can exceed the trigger.
- Limit-order entries, market-order exits, partial-fill tracking, cancellation of unfilled entries after 90 seconds, and blocking on uncertain submissions. Temporary provider timeouts/rate limits/server errors retry on later polls; uncertain order submissions never blindly retry.
- Saved cash/P&L ledger, one-minute equity observations, maximum observed drawdown, filled buy/sell order counts, open positions and strategy-scan explanations. Data is saved in `data/paper.json`; **Export paper ledger** downloads it with session details and any archived sessions.

At the end of the day, inspect **One-day automatic paper test** on the Live paper account page. Its P&L is relative to $2,000, calculated from actual paper fills and broker position marks **before fees and adjustments**. The separate $100,000 broker balance is not this test's performance. A zero-trade session is possible when no rules qualify, quotes are stale, or a whole share cannot fit the limit; the app does not invent trades.

## Launching again

Double-click **Start Signal Desk.cmd** in this folder. It reuses an existing local server or starts one in the background, then opens the paper page. Node.js must remain installed. The app is available only on this computer.

After a server restart, enter the paper keys again. A previously armed session can resume only after fresh reconciliation and calendar/risk checks; it will never resume after its dated entry window. A session you manually stopped stays stopped on reconnect. The optional `.env.local` setup is documented in [PAPER_SETUP.md](PAPER_SETUP.md); it is not configured on this PC.

## Verified and remaining

The 46 automated tests pass, including a simulated provider lifecycle from automatic entry through fills, closing, P&L and next-day lockout. The actual local session has been saved for September 30 with $2,000 and no paper orders submitted by this setup. Authenticated connection, tomorrow's data freshness, and actual external fills require the user to connect and the scheduled market session to occur. Paper results do not establish real-money performance: see [Alpaca's paper-trading limitations](https://docs.alpaca.markets/us/docs/paper-trading).

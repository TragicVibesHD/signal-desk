# Signal Desk profit and execution audit

Reviewed October 3, 2026. Changes concern paper execution and measurement; they do not establish a profitable strategy.

## Findings implemented

| Finding | Effect | Correction |
| --- | --- | --- |
| A bar was marked evaluated before quote and risk checks succeeded. | Missing quotes, temporarily wide spreads, occupied slots or cooldowns could discard an otherwise valid signal for the entire five-minute bar. | Retry preflight on later polls, only within 90 seconds of the signal bar completing. Stable signal identities and durable decisions prevent resending declined, cancelled, rejected or uncertain submissions. |
| Paper sizing used an arbitrary 0.3% price buffer instead of its executable limit. | Some whole shares that fitted every cash and risk limit were excluded; rounded stops could also cause otherwise oversized proposals to be rejected. | Size using the actual cent-rounded entry limit, rounded stop risk, active reservations, exposure, available cash and completed-bar participation. Submission still checks every restriction again. |
| A new idea used the fresh ask as its price-drift reference. | The initial signal-to-quote move was effectively unchecked. Some quotes could lose their breakout level or already meet an exit condition. | Reference the completed signal close; require the same completed bar at submission. Recheck breakout levels, VWAP boundaries, and the activity/scalp extension limits. |
| Replay fills and per-fill fees were rounded before trade aggregation. | Completed-trade profit and profitability statistics could differ from the cash ledger, especially with larger quantities or partial exits. | Keep full-precision modeled fills and fees; round aggregate statistics and display values. New version 5 research replaces earlier reports when rerun. Old rounded exports cannot be repaired without original execution amounts. |

At a $99.90 ask with a two-basis-point buffer, the executable limit is $99.92. Fifteen shares cost $1,498.80, within the scalp profile's $1,500 cap. The previous sizing calculation allowed fourteen shares. This is better use of the existing allocation, not evidence of higher expected profits. New dated sessions record engine version 5. Existing completed session history and frozen settings are preserved.

## Highest-value remaining work

1. **Establish whether an edge exists.** Reconnect Alpaca paper credentials locally and run the real-data comparison. Current loaded history is synthetic. The completed September 30 paper session earned $1.20 on $2,000 before broker fees, with five entries and no remaining positions; one day is insufficient to choose a profitable strategy. Compare the fixed baseline, active opening breakout and scalp profile across development, walk-forward and untouched future sessions. Do not increase exposure based on a synthetic winner.
2. **Measure execution before further scalping changes.** Record actual entry fills versus quotes, cancellation frequency, holding times, exits and drawdowns over multiple paper sessions. The existing entry slippage measurements only cover fills with captured quote observations. IEX quotes are not consolidated market quotes; completed five-minute bars and ten-second polling do not support subsecond scalping. Alpaca also describes execution differences between paper and live trading. [Alpaca paper trading](https://docs.alpaca.markets/us/docs/paper-trading).
3. **Make research closer to the broker.** Research still approximates next-bar market entries, fixed execution costs, participation and OHLC bracket sequencing. It does not replay the paper entry limit's actual fill/cancel behavior, queue priority or the bid/ask path. A quote/trade replay with capped-limit fills and measured costs is more useful than optimizing parameters against the current simplified model. Broker targets are limit orders and stops are stop-market orders; gaps can exceed the stop level. [Alpaca order documentation](https://docs.alpaca.markets/us/docs/orders-at-alpaca).
4. **Evaluate stability before adding complexity.** Expand the observation period and inspect losses by stock, strategy and time of day, with sufficient samples and a new untouched validation period. The six currently fixed large-cap stocks create universe-selection limitations. Adding many tunable filters or AI decisions increases the opportunity to fit noise; strategy selection must account for repeated trials. [Deflated Sharpe Ratio research](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf).

Borrowed margin and an AI decision layer were not added in this audit. Neither addresses the lack of real-data evidence. Current paper limits remain cash funded: the scalp profile permits one position, 75% allocation, a 0.4% stop, 0.8% target, 15-minute holding limit, eight daily entries and a 2% session loss guard. These controls constrain intended exposure; they cannot guarantee execution prices or profits.

## Verification

The version 5 suite adds ten regression tests covering whole-share boundary sizing, rounded stop risk, reservations and participation, recovery from missing quotes/wide spreads, fixed freshness deadlines, durable duplicate prevention, signal-close drift, lost entry conditions and subcent cash reconciliation. Provider responses in these tests are fixtures, not authenticated broker orders. The full suite contains 91 tests.

At inspection the local server was running, the saved session was complete and flat, and credentials were disconnected. No new paper session was armed during this audit.

Follow-up on October 3: real Yahoo Finance history has now replaced the synthetic replay after a local backup. The $2,000 real-data comparison is saved; all six final-test results were negative. See [REAL_DATA.md](REAL_DATA.md). The earlier audit's synthetic-data observation describes its original inspection, not the current loaded dataset.

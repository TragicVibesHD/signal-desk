# Real stock history loaded into Signal Desk

Downloaded and loaded October 3, 2026, from Yahoo Finance's public chart endpoint. This is historical market data, not synthetic prices or a live broker feed.

| Field | Loaded value |
| --- | --- |
| Stocks | AAPL, MSFT, NVDA, AMZN, META, GOOGL |
| Interval | Five-minute open, high, low, close, volume |
| Period | July 10–October 2, 2026 |
| Sessions | 60 complete regular sessions |
| Recorded bars | 28,080; 4,680 per stock |
| Calendar coverage | 100%; no missing slots or off-grid bars in this snapshot |
| Replay and research starting cash | $2,000 |
| Development / final test | 42 / 18 sessions |
| Dataset SHA-256 | `0a1d4f19bfc833253594dd319099e9e3d6d09d4a1f80130f8895aeb03d1db928` |

The prior synthetic replay account and dataset, including its simulated holdings, were backed up under `data/backups/`. Loading real history created a paused, review-first replay. The separate completed Alpaca paper session retains its original $1.20 P&L. No broker orders were placed for this download or comparison.

## Updating the history

Open **Data & connections**, select **Download public stock history**, then **Back up replay & load history**. Pause an active replay before loading. This requires no API key. Loading uses the saved paper session's allocation when present; the current allocation is $2,000. Public downloads may be rate limited or unavailable; the adapter does not retry failed stocks or load partial downloads.

Open **Strategy lab** and select **Compare loaded market history** to evaluate the loaded bars. **Download & compare Alpaca IEX** is a separate authenticated option using the existing Alpaca paper credentials and IEX entitlement.

Source details and dataset are saved locally in `data/dataset.json` and `data/downloaded-market.json`; the generated comparison is in `data/state.json`. These files, backups, credentials and screenshots are excluded from Git. GitHub contains the downloader, validation, UI and tests, rather than redistributing downloaded market data.

## Validation and limits

The adapter validates USD equity identity, timezone, five-minute interval, array lengths, duplicate timestamps, OHLC relationships, regular-session bounds and complete sessions. It retains missing bars as gaps, excludes after-hours/closing snapshots, and records excluded-row counts. The session calendar is provider supplied. For this snapshot, all 60 dates were also checked against weekdays and the published September 7 NYSE holiday. [NYSE hours and calendar](https://www.nyse.com/trade/hours-calendars).

Apple's 78 October 2 closing bar prices were independently checked against the Twelve Data public demo response: all were within one cent. This checks that day's close values; it does not validate the entire dataset, volumes or corporate actions. [Twelve Data trial documentation](https://support.twelvedata.com/en/articles/5335783-trial).

Yahoo's public chart endpoint is unofficial and may change. Its exchange coverage, volume and adjustment policy are not independently verified. It is not the Alpaca IEX feed used by the paper executor. Version 6 research explicitly requires matching IEX assumptions before qualifying a paper candidate. Prices and fees are still modeled from bars; quote paths, limit fill/cancel behavior and market impact remain approximate. The selected current six-stock universe has survivorship/selection limitations. Example source request: [Apple five-minute Yahoo chart](https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=60d&interval=5m&includePrePost=false&events=splits).

All six strategies lost money in the 18-session final test under the current modeled costs. Base/stress final P&L was: opening range −$33.52/−$83.62; VWAP reversion −$20.20/−$84.28; momentum −$52.18/−$129.81; active breakout −$7.33/−$16.85; scalp −$55.99/−$260.86; combined baseline −$84.19/−$229.02. These are historical simulations, not current-market paper fills or forecasts. The report status remains **More evidence needed**; no winning strategy was deployed.

## Software checks

98 automated tests pass. The seven new provider tests cover provenance and fixed endpoints, calendars/early closes, incomplete sessions, missing values, malformed responses, rate limits and all-or-nothing downloads. HTTP tests verify metadata after restart, local account backup, explicit replacement of simulated positions, $2,000 replay allocation and preservation of the Alpaca paper account.

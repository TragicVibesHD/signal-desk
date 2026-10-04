# Strategy research and next paper test

Reviewed October 3, 2026. The aim is to discover a repeatable return after costs while controlling losses. There is no credible basis here for promising 10–20% per day. Compounding 10% for 20 sessions multiplies capital by 6.73; 20% multiplies it by 38.34. Those are extraordinary outcomes, not a sensible income assumption.

## Evidence reviewed

| Approach | What the primary source supports | Decision for Signal Desk |
| --- | --- | --- |
| Opening breakouts in active stocks | [Zarattini, Barbon and Aziz](https://concretumgroup.com/wp-content/uploads/2026/02/A-Profitable-Day-Trading-Strategy-For-The-U.S.-Equity-Market.pdf) report a historical study of five-minute opening breakouts. Their activity filter compares opening volume with the previous 14 sessions. The study uses a much broader universe, both trade directions and leverage. | Test the activity idea as a separate long-only candidate. Published returns are not forecasts for our six stocks or $2,000 allocation. |
| Intraday momentum | [Gao et al., Journal of Financial Economics](https://profiles.wustl.edu/en/publications/market-intraday-momentum/) document early-to-late-session predictability in historical ETF data, stronger under some volume and volatility conditions. | Evidence for researching timing and activity, not validation of the app's moving-average rule. Do not describe our rule as a replication. |
| Picking the best backtest | [Bailey and López de Prado](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf) explain how multiple trials and reporting winners inflate performance estimates. | Keep all results visible, choose on development data, reserve a final chronological period, and show walk-forward and cost stress results. No statistical significance claim is calculated. |
| Paper execution | [Alpaca's specification](https://docs.alpaca.markets/us/docs/paper-trading) describes simulation omissions including market impact, latency slippage, queue position and fees. | Evaluate modeled costs separately. Paper gains are not equivalent to live gains. |

I did not identify an independently established “best high-return bot” applicable to this account in the reviewed evidence. Strategy code, vendor claims and backtested returns are different levels of evidence. An LLM making a buy/sell decision does not itself establish an edge. The next useful step is an auditable candidate and measurement, rather than paying for model calls before establishing a baseline.

## Implemented version 2

- Corrected the 30-minute opening-range warmup: it now requires the six actual opening bars rather than a global twelve-bar delay. Entries must be above VWAP so the signal does not already satisfy its exit condition. Quotes are rechecked at paper submission.
- Added a ten-minute symbol cooldown after exits in replay and current-market paper execution.
- Added **Active opening breakout**, a separate experiment. It requires 14 preceding opening volumes, opening volume at least 1.5× their average, a rising first five-minute candle, opening range width between 0.1% and 2%, and a subsequent close above its high and session VWAP. It avoids closes more than 1% above VWAP and accepts signals only before 11:00 ET. These thresholds are fixed design hypotheses, not optimized or independently validated parameters.
- Activity candidates compete in descending opening-volume ratio, rather than alphabetically, when cash or position slots are scarce. Paper submission still rechecks every risk limit and reconciles between orders.
- Research starts with $2,000 by default and the dated test's allocation limits. It compares each rule and the combined corrected baseline, reports daily returns, expectancy, profit factor, drawdown, residual holdings and stressed costs. It does not silently replace the saved session's strategy.
- Three expanding-window development folds select on past sessions and evaluate the next period. The final 30% is excluded from these selections. Prior volume is warmed up from earlier data only. Each evaluation increments a visible run count; reviewing and changing against the final set contaminates it.

The evidence screen requires real provider-labelled data, at least 60 total / 15 final sessions, 20 realized final-test exit fills, positive base and stress P&L, no residual holdings, and two profitable development folds. This is a conservative screening policy we chose, not an academic significance threshold or an automatic deployment approval.

## Run the next experiment

1. Keep the local server running in VS Code. Open [Signal Desk](http://127.0.0.1:4317/#paper) and connect Alpaca **paper** credentials locally. Do not paste them into chat or commit them.
2. In **Strategy lab**, choose $2,000 and click **Run real-data comparison**. It downloads up to 120 calendar days ending yesterday, runs the comparisons and saves results automatically. It leaves the paper session and replay holdings unchanged. Alternatively download and load a specific date range in Data & connections. IEX is one exchange, so volume ratios describe that feed, not consolidated market volume.
3. Read the failed evidence checks as well as returns. The demo remains clearly labelled synthetic. A second feed or broader universe would require separate data entitlements and eligibility work.
4. For prospective observation, choose a future exchange trading date in **Live paper account**, $2,000, and either **Corrected combined baseline** or **Active opening breakout · experimental**. Save and arm. The next regular weekday after this review is Monday, October 5; the app validates the broker calendar on connection.
5. Keep the PC plugged in, awake and online. Observe several sessions under frozen rules. Export the paper ledger and compare net returns, costs and drawdown. No next-day entries are permitted without a new dated test.

The experiment retains whole shares, no leverage, 25% maximum per stock, four positions, a 2% session-loss trigger, 1% stop, 2% target and 60-minute time exit. Gaps or unavailable execution can exceed a stop or loss trigger. Improving entry selection does not imply that more trades or larger risk will improve profits.

## Current evidence limitation

The persisted September 30 paper session completed with five buys and five sells, $1.20 P&L on its $2,000 allocation (0.06%) before fees, and no remaining positions. One session is insufficient to distinguish an edge from noise. No downloaded historical dataset or active credentials were available during this upgrade, so no real-data return improvement has been established. All synthetic evaluations are software validation only. Authenticated historical comparison and prospective paper observation remain the next evidence steps.

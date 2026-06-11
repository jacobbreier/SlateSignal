# SlateSignal

SlateSignal is an MLB-first sports analytics web app for matchup intelligence, market comparison, and model tracking.

It is designed to be both:

- A passion project about baseball
- A monetizable product concept with paid reports, alerts, creator tools, and team features

Easiest way to run it:

Double-click `Start SlateSignal.command`.

Then open:

```text
http://localhost:4173
```

Manual way to run it:

```bash
node server.js
```

Then open:

```text
http://localhost:4173
```

The local server fetches live data from MLB's Stats API and protects the app from hard-coding API calls in every page.

To add DraftKings and FanDuel odds:

1. Create an API key at The Odds API.
2. Open `config.env`.
3. Paste the key after `THE_ODDS_API_KEY=`.
4. Double-click `Start SlateSignal.command` again.

You can also start the server manually with the key:

```bash
THE_ODDS_API_KEY=your_key_here node server.js
```

The app asks The Odds API for MLB moneyline, spread, and total markets from DraftKings and FanDuel. This is the right path for a monetizable product because it avoids brittle or unauthorized scraping of sportsbook pages.

No-key option:

You can type DraftKings/FanDuel moneylines manually into the Market Edge cards. For example, enter `-125` or `+110`, and SlateSignal will compare that line against the model fair line.
Each sportsbook card also lets you choose which team the entered line belongs to.

Player projections:

SlateSignal also creates no-key probable pitcher projections when MLB publishes starters for the selected game. It uses season pitching stats to estimate innings, strikeouts, earned-run risk, ERA, and WHIP.
It also explains broad batter matchups by comparing each team's run-scoring profile against the opposing probable starter. Actual batting-order matchups can be added later when lineups are published.

The model does not ask for manual slider adjustments. It uses automatic factors from MLB data: win percentage gap, run differential gap, offense gap, run prevention gap, and probable pitcher edge.
It is intentionally conservative: game probabilities are regressed toward 50/50 and capped between 42% and 58%. Model v0.4 adds Pythagorean strength, recent form, home field, and a more balanced starter component.

Top model leans:

The app ranks every game on today's slate and surfaces a top model signal. This is a model lean based on current data, not betting advice.

Model record:

The app saves each day's model leans in `pick-log.json`. When you open the site later, the server checks MLB final scores and updates the running win/loss record automatically. This works while using the local Node server; a deployed version needs persistent storage so the log survives redeploys.
Today's games stay pending until MLB marks them Final, so the record shows "No finals" until at least one saved lean settles.

Live scores:

The app refreshes MLB score/status data about once per minute while open. Live sportsbook odds still require an odds provider such as The Odds API.

AI analyst chat:

The current chat is a local explanation engine. It answers from the selected matchup, model factors, manual odds inputs, and pitcher projections without requiring an AI API key. A later version can connect the same context to a real LLM for more flexible conversation.

Professional polish:

- The UI shows the current model version.
- Top model leans include the leading reasons behind each signal.
- Saved leans include a snapshot of the model factors used at run time.
- The record view separates today, yesterday, all-time, and pending leans.
- The backtest section summarizes saved-lean performance, captured-odds ROI when market lines are available, and a recent MLB historical sample using standings from before each game date.
- The app labels outputs as model signals, not certainty.

Good next build steps:

- Add probable pitchers and starting lineups
- Add hitter projections and batter-vs-pitcher context
- Add bullpen usage and rest calculations
- Add weather and ballpark factors
- Add odds movement from a paid provider
- Add user accounts and saved watchlists
- Add Stripe subscriptions for the Pro tier
- Add a historical sportsbook odds provider so older backtests can use true closing prices instead of flat even-money assumptions
- Add shareable matchup report pages for baseball creators

Current data source:

- MLB Stats API via `https://statsapi.mlb.com/api/v1`
- DraftKings/FanDuel odds via The Odds API when `THE_ODDS_API_KEY` is set

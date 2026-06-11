const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PICK_LOG_PATH = path.join(ROOT, "pick-log.json");
const MLB_BASE = "https://statsapi.mlb.com/api/v1";
const ODDS_API_KEY = process.env.THE_ODDS_API_KEY || "";
const ODDS_BASE = "https://api.the-odds-api.com/v4";
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".md": "text/markdown; charset=utf-8"
};

let cache = { timestamp: 0, data: null };
let backtestCache = { key: "", timestamp: 0, data: null };

const TEAM_ALIASES = {
  "athletics": "oakland athletics"
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function todayCentral() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function addDays(dateString, offsetDays) {
  const date = new Date(`${dateString}T12:00:00-05:00`);
  date.setDate(date.getDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function mlbDateParam(dateString) {
  const [year, month, day] = dateString.split("-");
  return `${month}/${day}/${year}`;
}

async function mlb(pathname) {
  const response = await fetch(`${MLB_BASE}${pathname}`);
  if (!response.ok) {
    throw new Error(`MLB request failed ${response.status}: ${pathname}`);
  }
  return response.json();
}

async function odds(pathname) {
  if (!ODDS_API_KEY) return [];

  const separator = pathname.includes("?") ? "&" : "?";
  const response = await fetch(`${ODDS_BASE}${pathname}${separator}apiKey=${ODDS_API_KEY}`);
  if (!response.ok) {
    throw new Error(`Odds request failed ${response.status}: ${pathname}`);
  }
  return response.json();
}

function normalizeName(name = "") {
  const cleaned = name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return TEAM_ALIASES[cleaned] || cleaned;
}

function flattenStandings(standings) {
  const stats = {};
  for (const record of standings.records || []) {
    for (const teamRecord of record.teamRecords || []) {
      const id = teamRecord.team.id;
      const runsScored = Number(teamRecord.runsScored || 0);
      const runsAllowed = Number(teamRecord.runsAllowed || 0);
      stats[id] = {
        wins: Number(teamRecord.wins || 0),
        losses: Number(teamRecord.losses || 0),
        winPct: Number(teamRecord.winningPercentage || 0.5),
        runsScored,
        runsAllowed,
        runDifferential: runsScored - runsAllowed,
        streak: teamRecord.streak?.streakCode || "N/A",
        lastTen: teamRecord.records?.splitRecords?.find((record) => record.type === "lastTen") || null
      };
    }
  }
  return stats;
}

function pythagoreanWinPct(stats = {}) {
  const runsScored = Number(stats.runsScored || 0);
  const runsAllowed = Number(stats.runsAllowed || 0);
  if (!runsScored || !runsAllowed) return Number(stats.winPct || 0.5);
  const exponent = 1.83;
  const scoredPower = Math.pow(runsScored, exponent);
  const allowedPower = Math.pow(runsAllowed, exponent);
  return scoredPower / (scoredPower + allowedPower);
}

function recentWinPct(stats = {}) {
  const lastTen = stats.lastTen;
  const wins = Number(lastTen?.wins || 0);
  const losses = Number(lastTen?.losses || 0);
  return wins + losses ? wins / (wins + losses) : Number(stats.winPct || 0.5);
}

function pitchingStatLine(playerStats) {
  const split = playerStats?.stats?.[0]?.splits?.[0];
  const stat = split?.stat || {};
  return {
    id: split?.player?.id,
    name: split?.player?.fullName,
    gamesStarted: Number(stat.gamesStarted || 0),
    inningsPitched: stat.inningsPitched || "0.0",
    strikeOuts: Number(stat.strikeOuts || 0),
    earnedRuns: Number(stat.earnedRuns || 0),
    era: stat.era || "N/A",
    whip: stat.whip || "N/A",
    opponentAvg: stat.avg || "N/A"
  };
}

function baseballInningsToDecimal(innings = "0.0") {
  const [whole, outs = "0"] = String(innings).split(".");
  return Number(whole || 0) + Number(outs || 0) / 3;
}

function probabilityFromEdge(edge) {
  return clamp(50 + edge * 1.05, 42, 58);
}

function probabilityToAmerican(probability) {
  const p = clamp(probability, 1, 99) / 100;
  if (p >= 0.5) return Math.round((-100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

function formatAmerican(price) {
  if (!Number.isFinite(price)) return "N/A";
  return `${price > 0 ? "+" : ""}${Math.round(price)}`;
}

function americanProfit(price, risk = 100) {
  if (!Number.isFinite(Number(price))) return null;
  return Number(price) > 0 ? risk * (Number(price) / 100) : risk * (100 / Math.abs(Number(price)));
}

function pricedResult(pick, won) {
  const price = Number(pick.market?.bestMoneyline?.price);
  if (!Number.isFinite(price)) return null;
  const risk = 100;
  const profit = won ? americanProfit(price, risk) : -risk;
  return {
    risk,
    profit: Number(profit.toFixed(2)),
    price,
    book: pick.market?.bestMoneyline?.book || "market"
  };
}

function simplifyGames(schedule) {
  const dates = schedule.dates || [];
  return dates.flatMap((date) =>
    (date.games || []).map((game) => ({
      gamePk: game.gamePk,
      gameTime: game.gameDate,
      status: game.status?.detailedState,
      abstractState: game.status?.abstractGameState,
      inning: game.linescore?.currentInning,
      inningHalf: game.linescore?.inningHalf,
      away: {
        id: game.teams.away.team.id,
        name: game.teams.away.team.name,
        score: game.teams.away.score,
        probablePitcherId: game.teams.away.probablePitcher?.id,
        probablePitcher: game.teams.away.probablePitcher?.fullName || "TBD"
      },
      home: {
        id: game.teams.home.team.id,
        name: game.teams.home.team.name,
        score: game.teams.home.score,
        probablePitcherId: game.teams.home.probablePitcher?.id,
        probablePitcher: game.teams.home.probablePitcher?.fullName || "TBD"
      }
    }))
  );
}

function findOddsEventForGame(oddsEvents, game) {
  const key = `${normalizeName(game.away.name)}__${normalizeName(game.home.name)}`;
  return (oddsEvents || []).find((event) => event.key === key);
}

function moneylineFromEvent(event, teamName) {
  return (event?.bookmakers || [])
    .flatMap((book) => {
      const market = (book.markets || []).find((item) => item.key === "h2h");
      return (market?.outcomes || [])
        .filter((outcome) => normalizeName(outcome.name) === normalizeName(teamName))
        .map((outcome) => ({
          book: book.title || book.key,
          bookKey: book.key,
          teamName,
          price: Number(outcome.price)
        }));
    })
    .filter((line) => Number.isFinite(line.price));
}

function marketSnapshotForPick(oddsEvents, game, pickTeamName) {
  const event = findOddsEventForGame(oddsEvents, game);
  const lines = moneylineFromEvent(event, pickTeamName);
  if (!lines.length) {
    return {
      capturedAt: new Date().toISOString(),
      source: ODDS_API_KEY ? "the-odds-api" : "not-configured",
      bestMoneyline: null,
      moneylines: []
    };
  }

  const bestMoneyline = lines
    .slice()
    .sort((a, b) => b.price - a.price)[0];
  return {
    capturedAt: new Date().toISOString(),
    source: "the-odds-api",
    bestMoneyline,
    moneylines: lines
  };
}

function modelFromTeamStats(game, statsById, starterEdge = 0) {
  const homeStats = statsById.get(Number(game.home.id)) || {};
  const awayStats = statsById.get(Number(game.away.id)) || {};
  const winPctGap = (Number(homeStats.winPct || 0.5) - Number(awayStats.winPct || 0.5)) * 100;
  const pythagGap = (pythagoreanWinPct(homeStats) - pythagoreanWinPct(awayStats)) * 100;
  const recentFormGap = (recentWinPct(homeStats) - recentWinPct(awayStats)) * 100;
  const runDiffGap = (Number(homeStats.runDifferential || 0) - Number(awayStats.runDifferential || 0)) / 18;
  const offenseGap = (Number(homeStats.runsScored || 0) - Number(awayStats.runsScored || 0)) / 12;
  const preventionGap = (Number(awayStats.runsAllowed || 0) - Number(homeStats.runsAllowed || 0)) / 12;
  const homeFieldEdge = 0.38;
  const rawEdge =
    winPctGap * 0.035 +
    pythagGap * 0.055 +
    recentFormGap * 0.018 +
    runDiffGap * 0.06 +
    offenseGap * 0.055 +
    preventionGap * 0.055 +
    starterEdge * 0.24 +
    homeFieldEdge;
  const edge = clamp(rawEdge, -6, 6);
  const leader = edge >= 0 ? game.home : game.away;
  const modelHomeProbability = probabilityFromEdge(edge);
  const modelLeaderProbability = edge >= 0 ? modelHomeProbability : 100 - modelHomeProbability;
  const fairLine = formatAmerican(probabilityToAmerican(modelLeaderProbability));
  const signal = Math.max(50, Math.min(66, 51 + Math.abs(edge) * 1.15 + Math.abs(pythagGap) * 0.025));
  const factors = {
    modelVersion: "v0.4 calibrated pregame",
    winPctGap: Number(winPctGap.toFixed(2)),
    pythagoreanGap: Number(pythagGap.toFixed(2)),
    recentFormGap: Number(recentFormGap.toFixed(2)),
    runDiffGap: Number(runDiffGap.toFixed(2)),
    offenseGap: Number(offenseGap.toFixed(2)),
    runPreventionGap: Number(preventionGap.toFixed(2)),
    pitcherEdge: Number(starterEdge.toFixed(2)),
    homeFieldEdge: Number(homeFieldEdge.toFixed(2)),
    modelProbability: Number(modelLeaderProbability.toFixed(1)),
    rawEdge: Number(rawEdge.toFixed(2)),
    edge: Number(edge.toFixed(2)),
    signal: Number(signal.toFixed(0)),
    fairLine
  };
  const reasons = [
    ["Win percentage gap", Math.abs(winPctGap * 0.035), winPctGap],
    ["Pythagorean strength gap", Math.abs(pythagGap * 0.055), pythagGap],
    ["Recent form gap", Math.abs(recentFormGap * 0.018), recentFormGap],
    ["Run differential gap", Math.abs(runDiffGap * 0.06), runDiffGap],
    ["Offense gap", Math.abs(offenseGap * 0.055), offenseGap],
    ["Run prevention gap", Math.abs(preventionGap * 0.055), preventionGap],
    ["Probable pitcher edge", Math.abs(starterEdge * 0.24), starterEdge],
    ["Home field", Math.abs(homeFieldEdge), homeFieldEdge]
  ]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label, , value]) => `${label}: ${value >= 0 ? "+" : ""}${value.toFixed(1)}`);

  return { leader, edge, signal, fairLine, factors, reasons, modelLeaderProbability };
}

function readPickLog() {
  try {
    return JSON.parse(fs.readFileSync(PICK_LOG_PATH, "utf8"));
  } catch {
    return { days: {} };
  }
}

function writePickLog(log) {
  fs.writeFileSync(PICK_LOG_PATH, `${JSON.stringify(log, null, 2)}\n`);
}

function summarizePickLog(log) {
  const days = Object.entries(log.days || {}).sort(([a], [b]) => b.localeCompare(a));
  const totals = days.reduce(
    (acc, [, day]) => {
      acc.wins += Number(day.wins || 0);
      acc.losses += Number(day.losses || 0);
      acc.pending += Number(day.pending || 0);
      acc.risk += Number(day.risk || 0);
      acc.profit += Number(day.profit || 0);
      acc.pricedPicks += Number(day.pricedPicks || 0);
      return acc;
    },
    { wins: 0, losses: 0, pending: 0, risk: 0, profit: 0, pricedPicks: 0 }
  );
  totals.profit = Number(totals.profit.toFixed(2));
  totals.roi = totals.risk ? Number(((totals.profit / totals.risk) * 100).toFixed(1)) : null;

  return {
    totals,
    days: days.map(([date, day]) => ({ date, ...day }))
  };
}

async function settlePickLog() {
  const log = readPickLog();
  let changed = false;

  for (const [date, day] of Object.entries(log.days || {})) {
    if (day.status === "settled" || !Array.isArray(day.picks)) continue;

    const schedule = await mlb(`/schedule?sportId=1&date=${date}&hydrate=linescore`);
    const results = new Map(
      simplifyGames(schedule).map((game) => [Number(game.gamePk), game])
    );

    let wins = 0;
    let losses = 0;
    let pending = 0;
    let risk = 0;
    let profit = 0;
    let pricedPicks = 0;

    day.picks = day.picks.map((pick) => {
      const result = results.get(Number(pick.gamePk));
      const final = result?.status === "Final" || result?.status === "Game Over";
      if (!result || !final) {
        pending += 1;
        return { ...pick, result: "pending" };
      }

      const winnerId = Number(result.home.score) > Number(result.away.score)
        ? Number(result.home.id)
        : Number(result.away.id);
      const won = Number(pick.pickTeamId) === winnerId;
      if (won) wins += 1;
      else losses += 1;
      const priced = pricedResult(pick, won);
      if (priced) {
        risk += priced.risk;
        profit += priced.profit;
        pricedPicks += 1;
      }
      return {
        ...pick,
        result: won ? "win" : "loss",
        pricedResult: priced,
        finalScore: `${result.away.name} ${result.away.score}, ${result.home.name} ${result.home.score}`
      };
    });

    day.wins = wins;
    day.losses = losses;
    day.pending = pending;
    day.risk = risk;
    day.profit = Number(profit.toFixed(2));
    day.roi = risk ? Number(((profit / risk) * 100).toFixed(1)) : null;
    day.pricedPicks = pricedPicks;
    day.status = pending ? "pending" : "settled";
    changed = true;
  }

  if (changed) writePickLog(log);
  return summarizePickLog(log);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body ? JSON.parse(body) : {}));
    req.on("error", reject);
  });
}

async function saveTodaysPicks(req) {
  const body = await readRequestBody(req);
  if (!body.date || !Array.isArray(body.picks)) {
    throw new Error("Expected date and picks");
  }

  const log = readPickLog();
  const existing = log.days[body.date] || {};
  log.days[body.date] = {
    date: body.date,
    status: existing.status === "settled" ? "settled" : "pending",
    savedAt: new Date().toISOString(),
    picks: body.picks.map((pick) => {
      const existingPick = existing.picks?.find((oldPick) => oldPick.gamePk === pick.gamePk) || {};
      return {
        ...existingPick,
        gamePk: pick.gamePk,
        matchup: pick.matchup,
        pickTeamId: pick.pickTeamId,
        pickTeamName: pick.pickTeamName,
        edge: pick.edge,
        signal: pick.signal,
        fairLine: pick.fairLine,
        modelVersion: pick.modelVersion,
        market: pick.market?.bestMoneyline ? pick.market : existingPick.market || pick.market || null,
        factors: pick.factors,
        reasons: pick.reasons,
        result: existingPick.result || "pending"
      };
    })
  };

  writePickLog(log);
  return settlePickLog();
}

async function savePicksFromSummary() {
  const summary = await buildSummary();
  const statsById = new Map(Object.entries(summary.teamStats || {}).map(([id, stats]) => [Number(id), stats]));
  const pitcherStatsById = new Map(Object.entries(summary.pitcherStats || {}).map(([id, stats]) => [Number(id), stats]));
  const pitcherProjection = (stats) => {
    if (!stats || !stats.gamesStarted) return null;
    const starts = Math.max(1, Number(stats.gamesStarted));
    return {
      strikeouts: Number(stats.strikeOuts || 0) / starts,
      innings: baseballInningsToDecimal(stats.inningsPitched) / starts,
      era: Number(stats.era),
      whip: Number(stats.whip)
    };
  };
  const pitcherEdge = (homePitcherId, awayPitcherId) => {
    const homeProjection = pitcherProjection(pitcherStatsById.get(Number(homePitcherId)));
    const awayProjection = pitcherProjection(pitcherStatsById.get(Number(awayPitcherId)));
    if (!homeProjection || !awayProjection) return 0;
    return ((awayProjection.era - homeProjection.era) * 0.38) +
      ((awayProjection.whip - homeProjection.whip) * 1.15) +
      ((homeProjection.strikeouts - awayProjection.strikeouts) * 0.14) +
      ((homeProjection.innings - awayProjection.innings) * 0.18);
  };
  const modelForGame = (game) => {
    const starterEdge = pitcherEdge(game.home.probablePitcherId, game.away.probablePitcherId);
    return modelFromTeamStats(game, statsById, starterEdge);
  };
  const picks = (summary.games || [])
    .map((game) => {
      const model = modelForGame(game);
      const market = marketSnapshotForPick(summary.odds, game, model.leader.name);
      return {
        gamePk: game.gamePk,
        matchup: `${game.away.name} at ${game.home.name}`,
        pickTeamId: model.leader.id,
        pickTeamName: model.leader.name,
        edge: Number(model.edge.toFixed(2)),
        signal: Number(model.signal.toFixed(0)),
        fairLine: model.fairLine,
        modelVersion: "v0.4 calibrated pregame",
        market,
        factors: model.factors,
        reasons: model.reasons
      };
    });

  const log = readPickLog();
  if (!log.days[summary.date]) {
    log.days[summary.date] = {
      date: summary.date,
      status: "pending",
      savedAt: new Date().toISOString(),
      picks,
      wins: 0,
      losses: 0,
      pending: picks.length
    };
    writePickLog(log);
  }
  return settlePickLog();
}

function emptyHistoricalBacktest(days) {
  return {
    configured: true,
    modelVersion: "v0.4 team-form historical",
    daysRequested: days,
    datesTested: 0,
    games: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    roi: null,
    buckets: [],
    recentDays: [],
    samplePicks: [],
    note: "No completed historical games were available for this window."
  };
}

async function standingsForDate(season, date) {
  return mlb(`/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason&date=${mlbDateParam(date)}`);
}

async function historicalBacktest(days = 14) {
  const safeDays = clamp(Number(days) || 14, 3, 30);
  const key = `${todayCentral()}-${safeDays}`;
  const now = Date.now();
  if (backtestCache.data && backtestCache.key === key && now - backtestCache.timestamp < 1000 * 60 * 30) {
    return backtestCache.data;
  }

  const today = todayCentral();
  const rows = [];
  const daySummaries = [];
  const bucketStats = new Map([
    ["50-52", { label: "50-52 signal", wins: 0, losses: 0 }],
    ["53-55", { label: "53-55 signal", wins: 0, losses: 0 }],
    ["56+", { label: "56+ signal", wins: 0, losses: 0 }]
  ]);
  let sampleWindow = "recent completed games";

  const runWindow = async (endDate, windowDays) => {
    for (let offset = -windowDays; offset <= -1; offset += 1) {
      const date = addDays(endDate, offset);
      const season = Number(date.slice(0, 4));
      const standingsDate = addDays(date, -1);

      try {
        const [schedule, standings] = await Promise.all([
          mlb(`/schedule?sportId=1&date=${date}&hydrate=linescore`),
          standingsForDate(season, standingsDate)
        ]);
        const statsById = new Map(
          Object.entries(flattenStandings(standings)).map(([id, stats]) => [Number(id), stats])
        );
        const finalGames = simplifyGames(schedule).filter(
          (game) => (game.status === "Final" || game.status === "Game Over") &&
            Number.isFinite(Number(game.home.score)) &&
            Number.isFinite(Number(game.away.score))
        );

        let wins = 0;
        let losses = 0;
        for (const game of finalGames) {
          if (!statsById.has(Number(game.home.id)) || !statsById.has(Number(game.away.id))) continue;
          const model = modelFromTeamStats(game, statsById, 0);
          const winnerId = Number(game.home.score) > Number(game.away.score)
            ? Number(game.home.id)
            : Number(game.away.id);
          const won = Number(model.leader.id) === winnerId;
          if (won) wins += 1;
          else losses += 1;

          const bucketKey = model.signal >= 56 ? "56+" : model.signal >= 53 ? "53-55" : "50-52";
          const bucket = bucketStats.get(bucketKey);
          if (won) bucket.wins += 1;
          else bucket.losses += 1;

          rows.push({
            date,
            gamePk: game.gamePk,
            matchup: `${game.away.name} at ${game.home.name}`,
            pickTeamName: model.leader.name,
            result: won ? "win" : "loss",
            finalScore: `${game.away.score}-${game.home.score}`,
            signal: Number(model.signal.toFixed(0)),
            edge: Number(model.edge.toFixed(2)),
            fairLine: model.fairLine,
            reasons: model.reasons
          });
        }

        if (finalGames.length) {
          daySummaries.push({
            date,
            games: wins + losses,
            wins,
            losses,
            winRate: wins + losses ? Number(((wins / (wins + losses)) * 100).toFixed(1)) : null
          });
        }
      } catch (error) {
        daySummaries.push({
          date,
          games: 0,
          wins: 0,
          losses: 0,
          skipped: true,
          message: error.message
        });
      }
    }
  };

  await runWindow(today, safeDays);
  if (!rows.length) {
    daySummaries.length = 0;
    sampleWindow = "prior-season fallback sample";
    await runWindow(`${Number(today.slice(0, 4)) - 1}-09-30`, Math.max(safeDays, 21));
  }

  const wins = rows.filter((row) => row.result === "win").length;
  const losses = rows.length - wins;
  const winRate = rows.length ? Number(((wins / rows.length) * 100).toFixed(1)) : null;
  const roi = rows.length ? Number((((wins * 100 - losses * 100) / (rows.length * 100)) * 100).toFixed(1)) : null;
  const data = rows.length ? {
    configured: true,
    modelVersion: "v0.4 team-form historical",
    daysRequested: safeDays,
    datesTested: daySummaries.filter((day) => !day.skipped && day.games).length,
    games: rows.length,
    wins,
    losses,
    winRate,
    roi,
    buckets: Array.from(bucketStats.values()).map((bucket) => {
      const total = bucket.wins + bucket.losses;
      return {
        ...bucket,
        games: total,
        winRate: total ? Number(((bucket.wins / total) * 100).toFixed(1)) : null
      };
    }),
    recentDays: daySummaries.slice(-10).reverse(),
    sampleWindow,
    samplePicks: rows
      .slice()
      .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))
      .slice(0, 8),
    note: `Historical test uses ${sampleWindow}, standings from before each game date, and excludes pitcher data to avoid future-stat leakage. ROI assumes flat $100 risk at even money until closing odds are stored.`
  } : emptyHistoricalBacktest(safeDays);

  backtestCache = { key, timestamp: now, data };
  return data;
}

async function analystChat(req) {
  const body = await readRequestBody(req);
  if (!process.env.OPENAI_API_KEY) {
    return {
      configured: false,
      message: "Real AI is not configured. The browser uses the local analyst until OPENAI_API_KEY is added."
    };
  }

  return {
    configured: false,
    message: "OPENAI_API_KEY is present, but the production LLM request is intentionally disabled until prompts and safety constraints are finalized.",
    received: Boolean(body?.question)
  };
}

async function probablePitcherStats(games, season) {
  const ids = [
    ...new Set(
      games.flatMap((game) => [game.away.probablePitcherId, game.home.probablePitcherId]).filter(Boolean)
    )
  ];
  const entries = await Promise.all(
    ids.map(async (id) => {
      try {
        const stats = await mlb(`/people/${id}/stats?stats=season&group=pitching&season=${season}&gameType=R`);
        return [id, pitchingStatLine(stats)];
      } catch {
        return [id, null];
      }
    })
  );
  return Object.fromEntries(entries.filter(([, stats]) => stats));
}

function simplifyOdds(oddsEvents) {
  return (oddsEvents || []).map((event) => ({
    id: event.id,
    commenceTime: event.commence_time,
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    key: `${normalizeName(event.away_team)}__${normalizeName(event.home_team)}`,
    bookmakers: (event.bookmakers || [])
      .filter((book) => ["draftkings", "fanduel"].includes(book.key))
      .map((book) => ({
        key: book.key,
        title: book.title,
        markets: (book.markets || []).map((market) => ({
          key: market.key,
          outcomes: (market.outcomes || []).map((outcome) => ({
            name: outcome.name,
            price: outcome.price,
            point: outcome.point
          }))
        }))
      }))
  }));
}

async function buildSummary() {
  const now = Date.now();
  if (cache.data && now - cache.timestamp < 1000 * 60 * 5) return cache.data;

  const season = new Date().getFullYear();
  const date = todayCentral();
  const oddsPath = "/sports/baseball_mlb/odds?regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel";
  const [teams, schedule, standings, oddsEvents] = await Promise.all([
    mlb(`/teams?sportId=1&season=${season}`),
    mlb(`/schedule?sportId=1&date=${date}&hydrate=probablePitcher,linescore`),
    mlb(`/standings?leagueId=103,104&season=${season}&standingsTypes=regularSeason`),
    odds(oddsPath)
  ]);
  const games = simplifyGames(schedule);
  const pitcherStats = await probablePitcherStats(games, season);

  cache = {
    timestamp: now,
    data: {
      date,
      generatedAt: new Date(now).toISOString(),
      source: `Live MLB Stats API data for ${date}. Ratings use current standings and run differential.`,
      oddsSource: ODDS_API_KEY
        ? "DraftKings/FanDuel odds via The Odds API."
        : "Market feed unavailable in this preview. Enter a moneyline manually to compare fair value.",
      oddsUpdatedAt: ODDS_API_KEY ? new Date(now).toISOString() : null,
      teams: teams.teams || [],
      games,
      teamStats: flattenStandings(standings),
      odds: simplifyOdds(oddsEvents),
      pitcherStats
    }
  };
  return cache.data;
}

function sendJSON(res, data) {
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(ROOT, requested));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(contents);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith("/api/mlb/summary")) {
      sendJSON(res, await buildSummary());
      return;
    }
    if (url.pathname.startsWith("/api/pick-log") && req.method === "GET") {
      sendJSON(res, await settlePickLog());
      return;
    }
    if (url.pathname.startsWith("/api/backtest/saved") && req.method === "GET") {
      sendJSON(res, await settlePickLog());
      return;
    }
    if (url.pathname.startsWith("/api/backtest/historical") && req.method === "GET") {
      sendJSON(res, await historicalBacktest(url.searchParams.get("days") || 14));
      return;
    }
    if (url.pathname.startsWith("/api/pick-log/today") && req.method === "POST") {
      sendJSON(res, await saveTodaysPicks(req));
      return;
    }
    if (url.pathname.startsWith("/api/analyst/chat") && req.method === "POST") {
      sendJSON(res, await analystChat(req));
      return;
    }
    if (url.pathname.startsWith("/api/jobs/daily") && req.method === "POST") {
      sendJSON(res, await savePicksFromSummary());
      return;
    }
    if (url.pathname.startsWith("/api/jobs/settle") && req.method === "POST") {
      sendJSON(res, await settlePickLog());
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SlateSignal MLB running on port ${PORT}`);
});

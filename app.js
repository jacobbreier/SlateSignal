const state = {
  teams: [],
  teamStats: new Map(),
  games: [],
  odds: [],
  pitcherStats: new Map(),
  source: "Loading MLB data..."
};

const homeTeam = document.querySelector("#homeTeam");
const awayTeam = document.querySelector("#awayTeam");
const themeToggle = document.querySelector("#themeToggle");
const gamesList = document.querySelector("#gamesList");
const betsList = document.querySelector("#betsList");
const betOfDay = document.querySelector("#betOfDay");
const recordCard = document.querySelector("#recordCard");
const backtestSummary = document.querySelector("#backtestSummary");
const backtestDays = document.querySelector("#backtestDays");
const historicalBacktest = document.querySelector("#historicalBacktest");
const draftkingsManual = document.querySelector("#draftkingsManual");
const fanduelManual = document.querySelector("#fanduelManual");
const draftkingsTeam = document.querySelector("#draftkingsTeam");
const fanduelTeam = document.querySelector("#fanduelTeam");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const chatMessages = document.querySelector("#chatMessages");
const accountForm = document.querySelector("#accountForm");
const accountEmail = document.querySelector("#accountEmail");
const accountStatus = document.querySelector("#accountStatus");
const subscriptionStatus = document.querySelector("#subscriptionStatus");
const subscriptionDetail = document.querySelector("#subscriptionDetail");
const checkoutButton = document.querySelector("#checkoutButton");
const MODEL_VERSION = "v0.4 calibrated pregame";

const formatSigned = (value) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
const pct = (value) => (Number.isFinite(value) ? value.toFixed(3).replace(/^0/, "") : ".500");
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hasTeamRecord = (stats) => Boolean(stats?.hasData && Number(stats.wins) + Number(stats.losses) > 0);
const escapeHTML = (value = "") => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

function normalizeName(name = "") {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function americanToDecimal(price) {
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
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

function expectedValue(modelProbability, americanPrice) {
  const decimal = americanToDecimal(americanPrice);
  const p = clamp(modelProbability, 1, 99) / 100;
  return (p * (decimal - 1) - (1 - p)) * 100;
}

function probabilityFromEdge(edge) {
  return clamp(50 + edge * 1.05, 42, 58);
}

function baseballInningsToDecimal(innings = "0.0") {
  const [whole, outs = "0"] = String(innings).split(".");
  return Number(whole || 0) + Number(outs || 0) / 3;
}

function liveStatusText(game) {
  if (!game) return "Pregame";
  if (game.abstractState === "Live" && game.inning) {
    return `${game.inningHalf || ""} ${game.inning}`.trim();
  }
  if (game.status === "Final" || game.abstractState === "Final") return "Final";
  if (game.status) return game.status;
  return "Pregame";
}

function gameScoreLabel(game) {
  const isScoredState = game?.abstractState === "Live" ||
    game?.abstractState === "Final" ||
    game?.status === "Final" ||
    game?.status === "Game Over";
  if (isScoredState && Number.isFinite(Number(game.away.score)) && Number.isFinite(Number(game.home.score))) {
    return `${game.away.score}-${game.home.score}`;
  }
  return game?.gameTime
    ? new Date(game.gameTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "Time TBD";
}

function recordLabel(homeStats, awayStats) {
  if (!hasTeamRecord(homeStats) || !hasTeamRecord(awayStats)) return "Data pending";
  return `${homeStats.wins}-${homeStats.losses} / ${awayStats.wins}-${awayStats.losses}`;
}

function winPctLabel(homeStats, awayStats) {
  if (!hasTeamRecord(homeStats) || !hasTeamRecord(awayStats)) return "Data pending";
  return `${pct(homeStats.winPct)} / ${pct(awayStats.winPct)}`;
}

function runsPerGame(stats) {
  if (!hasTeamRecord(stats)) return null;
  return ((Number(stats.runsScored || 0)) / Math.max(1, Number(stats.wins || 0) + Number(stats.losses || 0))).toFixed(2);
}

function localISODate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeTeam(apiTeam) {
  return {
    id: Number(apiTeam.id),
    name: apiTeam.name,
    abbreviation: apiTeam.abbreviation || apiTeam.teamCode || apiTeam.fileCode || ""
  };
}

function fallbackTeams() {
  return [
    [109, "Arizona Diamondbacks"], [144, "Atlanta Braves"], [110, "Baltimore Orioles"],
    [111, "Boston Red Sox"], [112, "Chicago Cubs"], [145, "Chicago White Sox"],
    [113, "Cincinnati Reds"], [114, "Cleveland Guardians"], [115, "Colorado Rockies"],
    [116, "Detroit Tigers"], [117, "Houston Astros"], [118, "Kansas City Royals"],
    [108, "Los Angeles Angels"], [119, "Los Angeles Dodgers"], [146, "Miami Marlins"],
    [158, "Milwaukee Brewers"], [142, "Minnesota Twins"], [121, "New York Mets"],
    [147, "New York Yankees"], [133, "Oakland Athletics"], [143, "Philadelphia Phillies"],
    [134, "Pittsburgh Pirates"], [135, "San Diego Padres"], [137, "San Francisco Giants"],
    [136, "Seattle Mariners"], [138, "St. Louis Cardinals"], [139, "Tampa Bay Rays"],
    [140, "Texas Rangers"], [141, "Toronto Blue Jays"], [120, "Washington Nationals"]
  ].map(([id, name]) => ({ id, name, abbreviation: "" }));
}

async function getJSON(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function postJSON(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

async function loadRealData() {
  try {
    const data = await getJSON("/api/mlb/summary");
    state.teams = data.teams.map(normalizeTeam).sort((a, b) => a.name.localeCompare(b.name));
    state.games = data.games || [];
    state.odds = data.odds || [];
    state.source = data.source;
    state.oddsSource = data.oddsSource;
    state.teamStats = new Map(
      Object.entries(data.teamStats || {}).map(([id, stats]) => [Number(id), { ...stats, hasData: true }])
    );
    state.pitcherStats = new Map(
      Object.entries(data.pitcherStats || {}).map(([id, stats]) => [Number(id), stats])
    );
  } catch (error) {
    state.teams = fallbackTeams();
    state.games = [];
    state.odds = [];
    state.teamStats = new Map();
    state.pitcherStats = new Map();
    state.source = "Using real MLB team names locally. Start the Node server for live MLB schedule and standings.";
    state.oddsSource = "Start the Node server and add THE_ODDS_API_KEY to compare DraftKings/FanDuel.";
  }

  fillTeams();
  renderGames();
  renderPickLog();
  renderAppStatus();
  renderDemoAccount();
}

function scheduleRefresh() {
  window.setTimeout(async () => {
    await loadRealData();
    scheduleRefresh();
  }, 60_000);
}

function fillTeams() {
  const previousHome = homeTeam.value;
  const previousAway = awayTeam.value;
  homeTeam.innerHTML = state.teams
    .map((team) => `<option value="${team.id}">${escapeHTML(team.name)}</option>`)
    .join("");
  awayTeam.innerHTML = state.teams
    .map((team) => `<option value="${team.id}">${escapeHTML(team.name)}</option>`)
    .join("");

  const firstGame = state.games[0];
  if (state.teams.some((team) => String(team.id) === previousHome) && state.teams.some((team) => String(team.id) === previousAway)) {
    homeTeam.value = previousHome;
    awayTeam.value = previousAway;
  } else if (firstGame) {
    awayTeam.value = String(firstGame.away.id);
    homeTeam.value = String(firstGame.home.id);
  } else {
    homeTeam.value = "112";
    awayTeam.value = "147";
  }

  updateDashboard();
}

function getTeam(id) {
  return state.teams.find((team) => team.id === Number(id));
}

function getStats(id) {
  return state.teamStats.get(Number(id)) || {
    wins: 0,
    losses: 0,
    winPct: 0.5,
    runDifferential: 0,
    runsScored: 0,
    runsAllowed: 0,
    streak: "N/A",
    hasData: false
  };
}

function pythagoreanWinPct(stats) {
  const runsScored = Number(stats.runsScored || 0);
  const runsAllowed = Number(stats.runsAllowed || 0);
  if (!runsScored || !runsAllowed) return Number(stats.winPct || 0.5);
  const exponent = 1.83;
  return Math.pow(runsScored, exponent) / (Math.pow(runsScored, exponent) + Math.pow(runsAllowed, exponent));
}

function recentWinPct(stats) {
  const lastTen = stats.lastTen;
  const wins = Number(lastTen?.wins || 0);
  const losses = Number(lastTen?.losses || 0);
  return wins + losses ? wins / (wins + losses) : Number(stats.winPct || 0.5);
}

function findOddsEvent(home, away) {
  const key = `${normalizeName(away.name)}__${normalizeName(home.name)}`;
  return state.odds.find((event) => event.key === key);
}

function findMoneyline(event, bookKey, teamName) {
  const book = event?.bookmakers?.find((item) => item.key === bookKey);
  const market = book?.markets?.find((item) => item.key === "h2h");
  const outcome = market?.outcomes?.find((item) => normalizeName(item.name) === normalizeName(teamName));
  return outcome?.price;
}

function moneylineSnapshot(event, teamName) {
  const moneylines = (event?.bookmakers || [])
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
  const bestMoneyline = moneylines.slice().sort((a, b) => b.price - a.price)[0] || null;
  return {
    capturedAt: new Date().toISOString(),
    source: moneylines.length ? "the-odds-api" : "not-available",
    bestMoneyline,
    moneylines
  };
}

function currentGame(home, away) {
  return state.games.find(
    (game) => Number(game.home.id) === Number(home.id) && Number(game.away.id) === Number(away.id)
  );
}

function pitcherProjection(stats) {
  if (!stats || !stats.gamesStarted) return null;
  const starts = Math.max(1, Number(stats.gamesStarted));
  return {
    innings: baseballInningsToDecimal(stats.inningsPitched) / starts,
    strikeouts: Number(stats.strikeOuts || 0) / starts,
    earnedRuns: Number(stats.earnedRuns || 0) / starts,
    era: stats.era,
    whip: stats.whip
  };
}

function projectionLabel(projection) {
  if (!projection) return "no starter data";
  return `${projection.era} ERA, ${projection.whip} WHIP, ${projection.strikeouts.toFixed(1)} projected K`;
}

function pitcherEdge(homePitcherId, awayPitcherId) {
  const homeProjection = pitcherProjection(state.pitcherStats.get(Number(homePitcherId)));
  const awayProjection = pitcherProjection(state.pitcherStats.get(Number(awayPitcherId)));
  if (!homeProjection || !awayProjection) return 0;

  const eraGap = Number(awayProjection.era) - Number(homeProjection.era);
  const whipGap = Number(awayProjection.whip) - Number(homeProjection.whip);
  const strikeoutGap = homeProjection.strikeouts - awayProjection.strikeouts;
  const workloadGap = homeProjection.innings - awayProjection.innings;
  return (eraGap * 0.38) + (whipGap * 1.15) + (strikeoutGap * 0.14) + (workloadGap * 0.18);
}

function renderPitcher(prefix, team, pitcherName, pitcherId) {
  const stats = state.pitcherStats.get(Number(pitcherId));
  const projection = pitcherProjection(stats);
  document.querySelector(`#${prefix}PitcherTeam`).textContent = team.name;
  document.querySelector(`#${prefix}PitcherName`).textContent = pitcherName || "TBD";

  if (!projection) {
    document.querySelector(`#${prefix}PitcherIp`).textContent = "N/A";
    document.querySelector(`#${prefix}PitcherK`).textContent = "N/A";
    document.querySelector(`#${prefix}PitcherEr`).textContent = "N/A";
    document.querySelector(`#${prefix}PitcherRate`).textContent = "N/A";
    return;
  }

  document.querySelector(`#${prefix}PitcherIp`).textContent = projection.innings.toFixed(1);
  document.querySelector(`#${prefix}PitcherK`).textContent = projection.strikeouts.toFixed(1);
  document.querySelector(`#${prefix}PitcherEr`).textContent = projection.earnedRuns.toFixed(1);
  document.querySelector(`#${prefix}PitcherRate`).textContent = `${projection.era} / ${projection.whip}`;
}

function renderPlayerProjections(home, away) {
  const game = currentGame(home, away);
  renderPitcher("away", away, game?.away.probablePitcher || "TBD", game?.away.probablePitcherId);
  renderPitcher("home", home, game?.home.probablePitcher || "TBD", game?.home.probablePitcherId);
  renderMatchupNotes(home, away, game);
}

function renderMatchupNotes(home, away, game) {
  const homeStats = getStats(home.id);
  const awayStats = getStats(away.id);
  const homePitcher = pitcherProjection(state.pitcherStats.get(Number(game?.home.probablePitcherId)));
  const awayPitcher = pitcherProjection(state.pitcherStats.get(Number(game?.away.probablePitcherId)));
  const awayOffense = runsPerGame(awayStats);
  const homeOffense = runsPerGame(homeStats);
  const starterGap = pitcherEdge(game?.home.probablePitcherId, game?.away.probablePitcherId);

  document.querySelector("#awayBatsMatchup").textContent =
    awayOffense
      ? `${away.name} score about ${awayOffense} runs per game and face ${game?.home.probablePitcher || "the home starter"} (${projectionLabel(homePitcher)}).`
      : `${away.name} matchup notes will populate when season run data is available.`;
  document.querySelector("#homeBatsMatchup").textContent =
    homeOffense
      ? `${home.name} score about ${homeOffense} runs per game and face ${game?.away.probablePitcher || "the visiting starter"} (${projectionLabel(awayPitcher)}).`
      : `${home.name} matchup notes will populate when season run data is available.`;
  document.querySelector("#starterDuel").textContent =
    starterGap > 0.4
      ? `${game?.home.probablePitcher || "The home starter"} grades better in the starter matchup.`
      : starterGap < -0.4
        ? `${game?.away.probablePitcher || "The visiting starter"} grades better in the starter matchup.`
        : "The starter matchup grades close based on available season stats.";
}

function updateOddsTeamOptions(home, away) {
  const options = [
    `<option value="${away.id}">${escapeHTML(away.name)}</option>`,
    `<option value="${home.id}">${escapeHTML(home.name)}</option>`
  ].join("");
  const currentDraftKings = draftkingsTeam.value;
  const currentFanDuel = fanduelTeam.value;
  draftkingsTeam.innerHTML = options;
  fanduelTeam.innerHTML = options;
  draftkingsTeam.value = [String(away.id), String(home.id)].includes(currentDraftKings) ? currentDraftKings : String(away.id);
  fanduelTeam.value = [String(away.id), String(home.id)].includes(currentFanDuel) ? currentFanDuel : String(away.id);
}

function modelForMatchup(home, away, game = currentGame(home, away)) {
  const homeStats = getStats(home.id);
  const awayStats = getStats(away.id);
  const winPctGap = (homeStats.winPct - awayStats.winPct) * 100;
  const pythagGap = (pythagoreanWinPct(homeStats) - pythagoreanWinPct(awayStats)) * 100;
  const recentFormGap = (recentWinPct(homeStats) - recentWinPct(awayStats)) * 100;
  const runDiffGap = (homeStats.runDifferential - awayStats.runDifferential) / 18;
  const offenseGap = ((homeStats.runsScored || 0) - (awayStats.runsScored || 0)) / 12;
  const preventionGap = ((awayStats.runsAllowed || 0) - (homeStats.runsAllowed || 0)) / 12;
  const starterEdge = pitcherEdge(game?.home.probablePitcherId, game?.away.probablePitcherId);
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
  const confidence = Math.max(50, Math.min(66, 51 + Math.abs(edge) * 1.15 + Math.abs(pythagGap) * 0.025));
  const leader = edge >= 0 ? home : away;
  const modelHomeProbability = probabilityFromEdge(edge);
  const modelLeaderProbability = edge >= 0 ? modelHomeProbability : 100 - modelHomeProbability;
  const fairLine = probabilityToAmerican(modelLeaderProbability);
  const risk = Math.abs(edge) < 1.2 ? "tight" : Math.abs(edge) < 3.2 ? "slight-lean" : "moderate-lean";

  return {
    homeStats,
    awayStats,
    winPctGap,
    pythagGap,
    recentFormGap,
    runDiffGap,
    offenseGap,
    preventionGap,
    starterEdge,
    homeFieldEdge,
    rawEdge,
    edge,
    confidence,
    leader,
    modelHomeProbability,
    modelLeaderProbability,
    fairLine,
    risk
  };
}

function modelFactorSnapshot(model) {
  return {
    modelVersion: MODEL_VERSION,
    winPctGap: Number(model.winPctGap.toFixed(2)),
    pythagoreanGap: Number(model.pythagGap.toFixed(2)),
    recentFormGap: Number(model.recentFormGap.toFixed(2)),
    runDiffGap: Number(model.runDiffGap.toFixed(2)),
    offenseGap: Number(model.offenseGap.toFixed(2)),
    runPreventionGap: Number(model.preventionGap.toFixed(2)),
    pitcherEdge: Number(model.starterEdge.toFixed(2)),
    homeFieldEdge: Number(model.homeFieldEdge.toFixed(2)),
    modelProbability: Number(model.modelLeaderProbability.toFixed(1)),
    rawEdge: Number(model.rawEdge.toFixed(2)),
    edge: Number(model.edge.toFixed(2)),
    signal: Number(model.confidence.toFixed(0)),
    fairLine: formatAmerican(model.fairLine)
  };
}

function pickReasons(model) {
  const factors = [
    {
      label: "Win percentage gap",
      value: model.winPctGap,
      impact: Math.abs(model.winPctGap * 0.035)
    },
    {
      label: "Pythagorean strength gap",
      value: model.pythagGap,
      impact: Math.abs(model.pythagGap * 0.055)
    },
    {
      label: "Recent form gap",
      value: model.recentFormGap,
      impact: Math.abs(model.recentFormGap * 0.018)
    },
    {
      label: "Run differential gap",
      value: model.runDiffGap,
      impact: Math.abs(model.runDiffGap * 0.06)
    },
    {
      label: "Offense gap",
      value: model.offenseGap,
      impact: Math.abs(model.offenseGap * 0.055)
    },
    {
      label: "Run prevention gap",
      value: model.preventionGap,
      impact: Math.abs(model.preventionGap * 0.055)
    },
    {
      label: "Probable pitcher edge",
      value: model.starterEdge,
      impact: Math.abs(model.starterEdge * 0.24)
    },
    {
      label: "Home field",
      value: model.homeFieldEdge,
      impact: Math.abs(model.homeFieldEdge)
    }
  ].sort((a, b) => b.impact - a.impact);

  return factors.slice(0, 3).map((factor) => `${factor.label}: ${formatSigned(factor.value)}`);
}

function renderBookEdge(bookKey, labelId, detailId, manualInput, teamSelect, event, home, away, modelHomeProbability) {
  const label = document.querySelector(labelId);
  const detail = document.querySelector(detailId);
  const selectedTeam = Number(teamSelect.value) === Number(home.id) ? home : away;
  const selectedProbability = Number(selectedTeam.id) === Number(home.id)
    ? modelHomeProbability
    : 100 - modelHomeProbability;
  const manualPrice = Number(manualInput.value);
  const apiPrice = findMoneyline(event, bookKey, selectedTeam.name);
  const price = Number.isFinite(manualPrice) && manualInput.value !== "" ? manualPrice : apiPrice;

  if (!Number.isFinite(price)) {
    label.textContent = state.odds.length ? "No line" : "Type line";
    detail.textContent = state.odds.length
      ? "No matching moneyline was returned. You can type the moneyline manually."
      : "Type the sportsbook moneyline to calculate estimated EV.";
    return;
  }

  const ev = expectedValue(selectedProbability, price);
  label.textContent = formatAmerican(price);
  detail.textContent = `${ev >= 0 ? "+" : ""}${ev.toFixed(1)}% estimated EV on ${selectedTeam.name} at ${selectedProbability.toFixed(1)}% model probability.`;
}

function updateDashboard() {
  const home = getTeam(homeTeam.value);
  const away = getTeam(awayTeam.value);
  if (!home || !away) return;

  const game = currentGame(home, away);
  const model = modelForMatchup(home, away, game);
  const oddsEvent = findOddsEvent(home, away);
  updateOddsTeamOptions(home, away);
  renderPlayerProjections(home, away);

  document.querySelector("#sportLabel").textContent = "MLB";
  document.querySelector("#matchupLabel").textContent = `${away.name} at ${home.name}`;
  document.querySelector("#edgeNumber").textContent = formatSigned(model.edge);
  document.querySelector("#edgeSummary").textContent = `${model.leader.name} has the current model lean based on standings and run profile.`;
  document.querySelector("#confidenceBar").style.width = `${model.confidence}%`;
  document.querySelector("#confidenceText").textContent = `Model signal ${model.confidence.toFixed(0)}%`;
  document.querySelector("#winPctGap").textContent = formatSigned(model.winPctGap);
  document.querySelector("#runDiffGap").textContent = formatSigned(model.runDiffGap);
  document.querySelector("#pitcherEdge").textContent = formatSigned(model.starterEdge);
  document.querySelector("#offenseGap").textContent = formatSigned(model.offenseGap);
  document.querySelector("#defenseGap").textContent = formatSigned(model.preventionGap);
  document.querySelector("#volatility").textContent = recordLabel(model.homeStats, model.awayStats);
  document.querySelector("#fanInterest").textContent = winPctLabel(model.homeStats, model.awayStats);
  document.querySelector("#watchTag").textContent = game?.abstractState === "Live" ? "Live score" : "Pregame model";
  document.querySelector("#liveStatus").textContent = liveStatusText(game);
  document.querySelector("#dataSource").textContent = state.source;
  document.querySelector("#oddsSource").textContent = state.oddsSource;
  document.querySelector("#fairLine").textContent = formatAmerican(model.fairLine);
  document.querySelector("#fairLineDetail").textContent = `${model.leader.name} at ${model.modelLeaderProbability.toFixed(1)}% model probability.`;
  document.querySelector("#oddsExplanation").textContent =
    `The model is deliberately conservative: it turns ${model.leader.name}'s ${model.modelLeaderProbability.toFixed(1)}% win probability into a fair line of ${formatAmerican(model.fairLine)}. If a sportsbook offers a better payout than that fair line for the selected team, the EV number becomes positive.`;
  renderBookEdge("draftkings", "#draftkingsLine", "#draftkingsEdge", draftkingsManual, draftkingsTeam, oddsEvent, home, away, model.modelHomeProbability);
  renderBookEdge("fanduel", "#fanduelLine", "#fanduelEdge", fanduelManual, fanduelTeam, oddsEvent, home, away, model.modelHomeProbability);
  document.querySelector("#generatedRead").textContent =
    `${model.leader.name} is the ${model.risk} side. This is a conservative pregame model lean, not a live-betting projection. Live scores update from MLB; live odds need an odds feed.`;
}

function renderFavoriteBets() {
  const picks = state.games
    .map((game) => {
      const home = getTeam(game.home.id);
      const away = getTeam(game.away.id);
      if (!home || !away) return null;
      const model = modelForMatchup(home, away, game);
      const oddsEvent = findOddsEvent(home, away);
      return {
        game,
        home,
        away,
        model,
        market: moneylineSnapshot(oddsEvent, model.leader.name),
        score: Math.abs(model.edge) + (model.confidence - 50) * 0.08
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (!picks.length) {
    betOfDay.innerHTML = `<span>Top signal</span><strong>No lean yet</strong><p>Load today's MLB slate to see the strongest model lean.</p>`;
    betsList.innerHTML = `<p class="empty-state">No model leans available.</p>`;
    return;
  }

  const top = picks[0];
  const topLine = top.market.bestMoneyline
    ? ` Best captured line: ${formatAmerican(top.market.bestMoneyline.price)} at ${escapeHTML(top.market.bestMoneyline.book)}.`
    : " No sportsbook line captured yet.";
  betOfDay.innerHTML = `
    <span>Top signal</span>
    <strong>${escapeHTML(top.model.leader.name)} moneyline</strong>
    <p>${formatSigned(top.model.edge)} model edge, ${top.model.confidence.toFixed(0)}% signal strength, fair line ${formatAmerican(top.model.fairLine)}.${topLine}</p>
  `;

  betsList.innerHTML = picks
    .map((pick) => {
      const marketLine = pick.market.bestMoneyline
        ? ` · best ${formatAmerican(pick.market.bestMoneyline.price)} at ${escapeHTML(pick.market.bestMoneyline.book)}`
        : " · no sportsbook line captured";
      return `
      <article class="bet-card">
        <span>${escapeHTML(pick.away.name)} at ${escapeHTML(pick.home.name)}</span>
        <strong>${escapeHTML(pick.model.leader.name)} moneyline</strong>
        <p>${formatSigned(pick.model.edge)} edge · ${pick.model.confidence.toFixed(0)}% signal · fair ${formatAmerican(pick.model.fairLine)}${marketLine}</p>
        <ol class="why-list">
          ${pickReasons(pick.model).map((reason) => `<li>${escapeHTML(reason)}</li>`).join("")}
        </ol>
      </article>
    `;
    })
    .join("");

  saveTodaysPicks(picks);
}

async function saveTodaysPicks(picks) {
  if (!state.games.length) return;
  const date = state.source.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/)?.[0] || localISODate();
  const payload = {
    date,
    picks: picks.map((pick) => ({
      gamePk: pick.game.gamePk,
      matchup: `${pick.away.name} at ${pick.home.name}`,
      pickTeamId: pick.model.leader.id,
      pickTeamName: pick.model.leader.name,
      edge: Number(pick.model.edge.toFixed(2)),
      signal: Number(pick.model.confidence.toFixed(0)),
      fairLine: formatAmerican(pick.model.fairLine),
      modelVersion: MODEL_VERSION,
      market: pick.market,
      factors: modelFactorSnapshot(pick.model),
      reasons: pickReasons(pick.model)
    }))
  };

  try {
    renderPickLog(await postJSON("/api/pick-log/today", payload));
  } catch {
    renderPickLog();
  }
}

async function renderPickLog(existingLog) {
  try {
    const log = existingLog || await getJSON("/api/pick-log");
    const totals = log.totals || { wins: 0, losses: 0, pending: 0 };
    const latest = log.days?.[0];
    const today = localISODate();
    const todayLog = (log.days || []).find((day) => day.date === today);
    const yesterdayDate = localISODate(-1);
    const yesterdayLog = (log.days || []).find((day) => day.date === yesterdayDate);
    const settledDays = (log.days || []).filter((day) => day.status === "settled").length;
    const dayLine = (label, day) => day
      ? `${label}: ${day.wins || 0}-${day.losses || 0}, ${day.pending || 0} pending`
      : `${label}: no saved leans`;
    const trackedRoi = totals.roi === null || totals.roi === undefined
      ? "No captured odds settled yet"
      : `${totals.roi > 0 ? "+" : ""}${totals.roi}% ROI on ${totals.pricedPicks} priced leans`;
    const recordHeadline = totals.wins + totals.losses ? `${totals.wins}-${totals.losses}` : "No finals";
    recordCard.innerHTML = `
      <span>Model record</span>
      <strong>${recordHeadline}</strong>
      <p>${dayLine("Today", todayLog)} · ${dayLine("Yesterday", yesterdayLog)} · ${trackedRoi}. ${settledDays} settled days so far.</p>
    `;
    renderBacktest(log);
  } catch {
    recordCard.innerHTML = `
      <span>Model record</span>
      <strong>Unavailable</strong>
      <p>Start the Node server to save and settle model leans automatically.</p>
    `;
    renderBacktest();
  }
}

function renderBacktest(log) {
  if (!log) {
    backtestSummary.innerHTML = `
      <article><span>All-time</span><strong>Unavailable</strong><p>Start the Node server.</p></article>
      <article><span>Pending</span><strong>Not loaded</strong><p>No log loaded.</p></article>
      <article><span>Captured ROI</span><strong>Unavailable</strong><p>No saved odds loaded.</p></article>
      <article><span>Model version</span><strong>v0.4</strong><p>Calibrated pregame.</p></article>
    `;
    historicalBacktest.innerHTML = `<p class="empty-state">Start the Node server to run the recent historical backtest.</p>`;
    return;
  }

  const totals = log.totals || { wins: 0, losses: 0, pending: 0 };
  const decided = totals.wins + totals.losses;
  const winRate = decided ? `${((totals.wins / decided) * 100).toFixed(1)}%` : "N/A";
  const roiLabel = totals.roi === null || totals.roi === undefined ? "N/A" : `${totals.roi > 0 ? "+" : ""}${totals.roi}%`;
  const profitLabel = totals.profit > 0 ? `+$${totals.profit.toFixed(2)}` : `$${Number(totals.profit || 0).toFixed(2)}`;
  const savedHeadline = decided ? `${totals.wins}-${totals.losses}` : "No finals";
  backtestSummary.innerHTML = `
    <article><span>Saved leans</span><strong>${savedHeadline}</strong><p>${winRate} win rate on settled saved leans.</p></article>
    <article><span>Pending</span><strong>${totals.pending}</strong><p>Waiting for MLB finals.</p></article>
    <article><span>Captured ROI</span><strong>${roiLabel}</strong><p>${profitLabel} profit on ${totals.pricedPicks || 0} leans with saved odds.</p></article>
    <article><span>Model version</span><strong>v0.4</strong><p>Calibrated pregame.</p></article>
  `;

  renderHistoricalBacktest();

  const days = log.days || [];
  if (!days.length) {
    backtestDays.innerHTML = `<p class="empty-state">Saved lean history will appear here.</p>`;
    return;
  }

  backtestDays.innerHTML = days
    .slice(0, 14)
      .map((day) => `
      <article class="backtest-day">
        <span>${escapeHTML(day.date)}</span>
        <strong>${day.wins || 0}-${day.losses || 0}</strong>
        <p>${day.pending || 0} pending · ${day.picks?.length || 0} saved leans · ${day.roi === null || day.roi === undefined ? "no captured ROI" : `${day.roi > 0 ? "+" : ""}${day.roi}% ROI`} · ${escapeHTML(day.status || "pending")}</p>
      </article>
    `)
    .join("");
}

async function renderHistoricalBacktest() {
  if (!historicalBacktest) return;
  historicalBacktest.innerHTML = `<p class="empty-state">Running recent historical test...</p>`;

  try {
    const test = await getJSON("/api/backtest/historical?days=14");
    if (!test.games) {
      historicalBacktest.innerHTML = `<p class="empty-state">${escapeHTML(test.note || "No completed historical games were available for this window.")}</p>`;
      return;
    }

    const buckets = (test.buckets || [])
      .map((bucket) => `
        <article>
          <span>${escapeHTML(bucket.label)}</span>
          <strong>${bucket.wins}-${bucket.losses}</strong>
          <p>${bucket.winRate === null ? "N/A" : `${bucket.winRate}%`} win rate · ${bucket.games} games</p>
        </article>
      `)
      .join("");

    const samplePicks = (test.samplePicks || [])
      .map((pick) => `
        <article class="backtest-day">
          <span>${escapeHTML(pick.date)} · ${escapeHTML(pick.result)}</span>
          <strong>${escapeHTML(pick.pickTeamName)}</strong>
          <p>${escapeHTML(pick.matchup)} · final ${escapeHTML(pick.finalScore)} · ${pick.signal}% signal · fair ${escapeHTML(pick.fairLine)}</p>
        </article>
      `)
      .join("");

    historicalBacktest.innerHTML = `
      <div class="historical-summary">
        <article>
          <span>Recent sample</span>
          <strong>${test.wins}-${test.losses}</strong>
          <p>${test.winRate}% win rate across ${test.games} completed games.</p>
        </article>
        <article>
          <span>Estimated ROI</span>
          <strong>${test.roi > 0 ? "+" : ""}${test.roi}%</strong>
          <p>Flat $100 even-money estimate; saved leans use captured odds when available.</p>
        </article>
        <article>
          <span>Dates tested</span>
          <strong>${test.datesTested}</strong>
          <p>${escapeHTML(test.modelVersion)}</p>
        </article>
      </div>
      <div class="historical-buckets">${buckets}</div>
      <div class="historical-note">${escapeHTML(test.note)}</div>
      <h3 class="mini-heading">Strongest historical leans</h3>
      <div class="backtest-days">${samplePicks}</div>
    `;
  } catch {
    historicalBacktest.innerHTML = `<p class="empty-state">Historical backtest is unavailable. Restart the local server after the update.</p>`;
  }
}

function selectedContext() {
  const home = getTeam(homeTeam.value);
  const away = getTeam(awayTeam.value);
  if (!home || !away) return null;
  const game = currentGame(home, away);
  const model = modelForMatchup(home, away, game);
  const homePitcher = pitcherProjection(state.pitcherStats.get(Number(game?.home.probablePitcherId)));
  const awayPitcher = pitcherProjection(state.pitcherStats.get(Number(game?.away.probablePitcherId)));
  return { home, away, game, model, homePitcher, awayPitcher };
}

function strongestFactor(model) {
  const factors = [
    ["win percentage", Math.abs(model.winPctGap * 0.035), model.winPctGap],
    ["Pythagorean strength", Math.abs(model.pythagGap * 0.055), model.pythagGap],
    ["recent form", Math.abs(model.recentFormGap * 0.018), model.recentFormGap],
    ["run differential", Math.abs(model.runDiffGap * 0.06), model.runDiffGap],
    ["offense", Math.abs(model.offenseGap * 0.055), model.offenseGap],
    ["run prevention", Math.abs(model.preventionGap * 0.055), model.preventionGap],
    ["probable pitching", Math.abs(model.starterEdge * 0.24), model.starterEdge],
    ["home field", Math.abs(model.homeFieldEdge), model.homeFieldEdge]
  ].sort((a, b) => b[1] - a[1]);
  return factors[0];
}

function manualOddsSummary() {
  const books = [
    ["DraftKings", draftkingsManual.value, draftkingsTeam.options[draftkingsTeam.selectedIndex]?.text],
    ["FanDuel", fanduelManual.value, fanduelTeam.options[fanduelTeam.selectedIndex]?.text]
  ].filter(([, value]) => value !== "");

  if (!books.length) return "No manual sportsbook line is entered yet.";
  return books.map(([book, value, team]) => `${book} is entered as ${formatAmerican(Number(value))} for ${team}.`).join(" ");
}

function analystReply(question) {
  const context = selectedContext();
  if (!context) return "I need a selected matchup before I can explain the odds.";

  const { home, away, game, model, homePitcher, awayPitcher } = context;
  const q = question.toLowerCase();
  const factor = strongestFactor(model);
  const fair = `${model.leader.name} at ${model.modelLeaderProbability.toFixed(1)}%, fair line ${formatAmerican(model.fairLine)}`;

  if (q.includes("odd") || q.includes("line") || q.includes("fair") || q.includes("ev")) {
    return `${fair}. The fair line comes from the model probability, not from a sportsbook. ${manualOddsSummary()} If the sportsbook payout is better than the fair line for the selected team, the estimated EV becomes positive.`;
  }

  if (q.includes("why") || q.includes("factor") || q.includes("like") || q.includes("favorite")) {
    return `The model leans ${model.leader.name} mostly because of ${factor[0]}. Current factor values: win pct ${formatSigned(model.winPctGap)}, Pythagorean strength ${formatSigned(model.pythagGap)}, recent form ${formatSigned(model.recentFormGap)}, run diff ${formatSigned(model.runDiffGap)}, offense ${formatSigned(model.offenseGap)}, run prevention ${formatSigned(model.preventionGap)}, pitcher edge ${formatSigned(model.starterEdge)}, home field ${formatSigned(model.homeFieldEdge)}.`;
  }

  if (q.includes("pitch") || q.includes("starter")) {
    return `${game?.away.probablePitcher || "The away starter"}: ${projectionLabel(awayPitcher)}. ${game?.home.probablePitcher || "The home starter"}: ${projectionLabel(homePitcher)}. Starter edge is ${formatSigned(model.starterEdge)}, where positive helps ${home.name} and negative helps ${away.name}.`;
  }

  if (q.includes("batter") || q.includes("hit") || q.includes("lineup") || q.includes("offense")) {
    const awayRuns = ((model.awayStats.runsScored || 0) / Math.max(1, model.awayStats.wins + model.awayStats.losses)).toFixed(2);
    const homeRuns = ((model.homeStats.runsScored || 0) / Math.max(1, model.homeStats.wins + model.homeStats.losses)).toFixed(2);
    return `${away.name} are scoring about ${awayRuns} runs per game and ${home.name} are scoring about ${homeRuns}. This is still team-level batter context; the next upgrade would pull confirmed lineups and hitter handedness splits.`;
  }

  if (q.includes("confidence") || q.includes("risk")) {
    return `Signal strength is ${model.confidence.toFixed(0)}%. It is deliberately capped because MLB game predictions should stay conservative and be judged against saved results and closing lines. This matchup is tagged as ${model.risk}.`;
  }

  return `${fair}. The biggest driver is ${factor[0]}. Ask me about odds, pitcher matchup, offense, confidence, or why the model likes a side and I can break it down.`;
}

function addChatMessage(text, type) {
  const message = document.createElement("div");
  message.className = `chat-message ${type}`;
  message.textContent = text;
  chatMessages.append(message);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderDemoAccount() {
  const legacyEmail = window.localStorage.getItem("edgeboardEmail");
  if (legacyEmail && !window.localStorage.getItem("slatesignalEmail")) {
    window.localStorage.setItem("slatesignalEmail", legacyEmail);
    window.localStorage.removeItem("edgeboardEmail");
  }
  const email = window.localStorage.getItem("slatesignalEmail");
  if (email) {
    accountEmail.value = email;
    accountStatus.textContent = email;
  } else {
    accountStatus.textContent = "Signed out";
  }
}

async function renderAppStatus() {
  try {
    const status = await getJSON("/api/status");
    subscriptionStatus.textContent = status.payments?.configured ? "Stripe ready" : "Free plan";
    subscriptionDetail.textContent = status.payments?.configured
      ? "Stripe checkout is configured on this server."
      : "Checkout is a roadmap preview. Add auth, terms, STRIPE_SECRET_KEY, STRIPE_PRICE_ID, and PUBLIC_BASE_URL before accepting payments.";
    checkoutButton.disabled = false;
  } catch {
    subscriptionStatus.textContent = "Local mode";
    subscriptionDetail.textContent = "Start the Node server to check payment/auth configuration.";
  }
}

function renderGames() {
  if (!state.games.length) {
    gamesList.innerHTML = `<p class="empty-state">No MLB games were returned for today, or live data is unavailable.</p>`;
    return;
  }

  gamesList.innerHTML = state.games
    .map((game) => {
      return `
        <button class="game-pill" type="button" data-away="${game.away.id}" data-home="${game.home.id}">
          <span>${escapeHTML(game.away.name)} at ${escapeHTML(game.home.name)}</span>
          <strong>${gameScoreLabel(game)}</strong>
          <small>${escapeHTML(liveStatusText(game))} · ${escapeHTML(game.away.probablePitcher)} vs ${escapeHTML(game.home.probablePitcher)}</small>
        </button>
      `;
    })
    .join("");

  gamesList.querySelectorAll(".game-pill").forEach((button) => {
    button.addEventListener("click", () => {
      awayTeam.value = button.dataset.away;
      homeTeam.value = button.dataset.home;
      updateDashboard();
    });
  });
  renderFavoriteBets();
}

homeTeam.addEventListener("change", updateDashboard);
awayTeam.addEventListener("change", updateDashboard);
draftkingsManual.addEventListener("input", updateDashboard);
fanduelManual.addEventListener("input", updateDashboard);
draftkingsTeam.addEventListener("change", updateDashboard);
fanduelTeam.addEventListener("change", updateDashboard);
themeToggle.addEventListener("click", () => document.body.classList.toggle("compact"));
accountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const email = accountEmail.value.trim();
  if (!email) return;
  window.localStorage.setItem("slatesignalEmail", email);
  renderDemoAccount();
});
checkoutButton.addEventListener("click", async () => {
  subscriptionDetail.textContent = "Checking checkout configuration...";
  try {
    const session = await postJSON("/api/checkout", {});
    if (session.url) {
      window.location.href = session.url;
      return;
    }
    subscriptionDetail.textContent = session.message || "Checkout is not configured yet.";
  } catch {
    subscriptionDetail.textContent = "Checkout preview is unavailable while the server is unreachable.";
  }
});
chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const question = chatInput.value.trim();
  if (!question) return;
  addChatMessage(question, "user");
  chatInput.value = "";
  addChatMessage(analystReply(question), "analyst");
});

loadRealData();
scheduleRefresh();

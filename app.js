const accounts = {
  guest: {
    name: "Guest",
    email: "",
    avatar: "G",
    role: "Guest",
    access: [],
    playerId: null,
  },
};

let leagueSeason = null;
let standings = [];
let matchups = [];
let lineMatches = [];
let teamsById = new Map();
let leagueDataLoaded = false;
let historySeasons = [];
let historyDataLoaded = false;
let springSeasonData = null;
let springLineEditIndex = new Map();

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let currentAccountKey = "guest";

function allowed(element, account) {
  if (account.role === "Super Admin") return true;
  const accessAny = (element.dataset.accessAny || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (accessAny.length)
    return accessAny.some((access) => account.access.includes(access));
  const access = element.dataset.access;
  return !access || account.access.includes(access);
}

function setAccount(key, announce = false) {
  currentAccountKey = key;
  const account = accounts[key];
  document.body.dataset.account = key;
  $("#profileName").textContent =
    key === "guest" ? "Sign in" : account.name.split(" ")[0];
  $("#profileRole").textContent = account.role;
  $("#avatar").textContent = account.avatar;
  $$("[data-access],[data-access-any]").forEach(
    (el) => (el.hidden = !allowed(el, account)),
  );
  $$("[data-super-admin]").forEach(
    (el) => (el.hidden = account.role !== "Super Admin"),
  );
  const active = $(".view.active");
  if (active && !allowed(active, account)) navigate("home");
  renderWorkspace(account);
  renderHistory(account);
  renderSpringSeason();
  if (announce)
    showToast(key === "guest" ? "Signed out" : `Signed in as ${account.name}`);
}

function renderWorkspace(account) {
  $("#workspaceKicker").textContent =
    account.role === "Guest" ? "Public league" : `${account.role} workspace`;
  $("#welcomeTitle").textContent =
    account.role === "Guest"
      ? "Welcome to AlphaOpen"
      : `Welcome, ${account.name.split(" ")[0]}`;
  $("#roleBadge").textContent = account.role;
  const copy = {
    Guest:
      "Follow scores, standings and league rules. Sign in for your private workspace.",
    "Super Admin":
      "Manage every season setting, account, roster, approval and result.",
    EC: "Review season operations, rosters, replacements and data quality.",
    "Neutral Approver":
      "One lineup pair is ready for sealed review and publication.",
    Captain:
      "Your captain account is active; a team assignment is still required.",
    Player: "Your player profile is active and ready for future match history.",
    "Pending approval":
      "Your Google account is verified. A Super Admin must approve your AlphaOpen registration before private access is enabled.",
    "Registration rejected":
      "Your registration was not approved. Contact an AlphaOpen Super Admin if you believe this is an error.",
    "Account suspended":
      "Your AlphaOpen access is suspended. Contact an AlphaOpen Super Admin for assistance.",
  };
  $("#welcomeCopy").textContent = copy[account.role] || copy.Guest;
  const actions = [];
  if (account.access.includes("captain"))
    actions.push(["lineup", "Build lineup", "Run SOR checks"]);
  if (account.access.includes("approver"))
    actions.push(["approvals", "Review lineups", "Publish both together"]);
  if (account.access.includes("ec"))
    actions.push(["admin", "Season admin", "Manage people and data"]);
  if (account.access.includes("player"))
    actions.push(["history", "My history", "Private Player ID record"]);
  if (!actions.length)
    actions.push(
      ["schedule", "Match results", "All seven weeks"],
      ["standings", "Standings", "Final regular season"],
    );
  $("#quickActions").innerHTML = actions
    .map(
      ([route, title, sub]) =>
        `<button data-route="${route}"><b>${title}</b><small>${sub}</small><span>→</span></button>`,
    )
    .join("");
  bindRoutes($("#quickActions"));
}

function navigate(route) {
  const target = $(`.view[data-view="${route}"]`);
  if (!target || target.hidden) return;
  $$(".view").forEach((view) =>
    view.classList.toggle("active", view === target),
  );
  $$("[data-route]").forEach((button) =>
    button.classList.toggle("active", button.dataset.route === route),
  );
  closeDrawer();
  if (location.hash !== `#${route}`)
    history.pushState({ route }, "", `#${route}`);
  document.title =
    route === "home"
      ? "AlphaOpen Tennis League"
      : `${target.querySelector("h1")?.textContent || route} · AlphaOpen`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function bindRoutes(root = document) {
  $$("[data-route]", root).forEach((button) => {
    if (!button.dataset.bound) {
      button.dataset.bound = "1";
      button.addEventListener("click", () => {
        navigate(button.dataset.route);
        button.closest("details")?.removeAttribute("open");
      });
    }
  });
}
function setAdminPanel(panel) {
  $$("[data-admin-panel]").forEach((button) =>
    button.classList.toggle("active", button.dataset.adminPanel === panel),
  );
  $$("[data-admin-section]").forEach((section) => {
    const selected = section.dataset.adminSection === panel;
    section.hidden = !selected;
    section.classList.toggle("active", selected);
  });
}
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function teamName(teamId, snapshot = "") {
  return (teamsById.get(teamId)?.name || snapshot || teamId || "Team").replace(
    /^Team\s+/i,
    "",
  );
}
function stageLabel(weekId) {
  if (/^W\d+$/.test(weekId || "")) return `Week ${weekId.slice(1)}`;
  return (
    { QF: "Quarterfinal", SF: "Semifinal", F: "Final" }[weekId] ||
    weekId ||
    "Match"
  );
}
function formatDate(value, options = { month: "short", day: "2-digit" }) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf())
    ? new Intl.DateTimeFormat("en-US", options).format(date)
    : "Date not recorded";
}
function formatPlayedAt(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf())
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date)
    : "Not recorded";
}
function dateTimeInputValue(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  if (!date || Number.isNaN(date.valueOf())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date - offset).toISOString().slice(0, 16);
}
function openSpringLineEditor(line, matchup) {
  if (accounts[currentAccountKey]?.role !== "Super Admin") return;
  const home = line.homePlayers || [],
    away = line.awayPlayers || [],
    sets = line.sets || [];
  $("#springLineEditorId").textContent =
    `${matchup.matchupId} · Line ${line.lineNumber}`;
  $("#springEditMatchupId").value = matchup.matchupId;
  $("#springEditLineId").value = line.lineMatchId;
  [
    ["springHomePlayer1", home[0]],
    ["springHomePlayer2", home[1]],
    ["springAwayPlayer1", away[0]],
    ["springAwayPlayer2", away[1]],
  ].forEach(([prefix, player]) => {
    $(`#${prefix}Id`).value = player?.playerId || "";
    $(`#${prefix}Name`).value =
      player?.nameSnapshot || player?.playerNameSnapshot || "";
  });
  $("#springPlayedAt").value = dateTimeInputValue(line.scheduledAt);
  $("#springVenueName").value = line.venueNameSnapshot || "";
  $("#springHomePoints").value = Number(line.homePoints || 0);
  $("#springAwayPoints").value = Number(line.awayPoints || 0);
  [1, 2, 3].forEach((number) => {
    const set = sets.find((item) => Number(item.setNumber) === number);
    $(`#springHomeSet${number}`).value = set?.homeScore ?? "";
    $(`#springAwaySet${number}`).value = set?.awayScore ?? "";
  });
  $("#springLineEditorMessage").textContent =
    "Changes update the operational and public Firebase records together.";
  $("#springLineEditor").showModal();
}

function safeText(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ],
  );
}
function fullTeamName(teamId, snapshot = "", teamMap = teamsById) {
  const name = teamMap.get(teamId)?.name || snapshot || teamId || "Team";
  return /^Team\s/i.test(name) ? name : `Team ${name}`;
}
function playerPair(players = []) {
  return (
    players
      .map(
        (player) =>
          player.nameSnapshot ||
          player.playerNameSnapshot ||
          player.name ||
          player.playerId,
      )
      .filter(Boolean)
      .join(" / ") || "Players TBD"
  );
}
function lineScore(line) {
  return (
    (line.sets || [])
      .map((set) => `${set.homeScore ?? "–"}-${set.awayScore ?? "–"}`)
      .join("  ") || "Score pending"
  );
}
function seasonStageTitle(weekId) {
  return (
    { F: "Final", SF: "Semifinals", QF: "Quarterfinals" }[weekId] ||
    stageLabel(weekId)
  );
}
function canonicalStage(value = "") {
  const compact = String(value).replace(/\s+/g, "").toUpperCase();
  if (/^W(?:EEK)?\d+$/.test(compact)) return `W${compact.match(/\d+/)[0]}`;
  return (
    {
      FINAL: "F",
      SEMIFINAL: "SF",
      SEMIFINALS: "SF",
      QUARTERFINAL: "QF",
      QUARTERFINALS: "QF",
    }[compact] || compact
  );
}
function openSpringMatchup(matchupId) {
  const matchup = (springSeasonData?.matchups || []).find(
    (item) => item.matchupId === matchupId,
  );
  if (!matchup) return;
  const weekFilter = $("#springWeekFilter"),
    teamFilter = $("#springTeamFilter"),
    playerFilter = $("#springPlayerFilter");
  if (weekFilter) weekFilter.value = canonicalStage(matchup.weekId);
  if (teamFilter) teamFilter.value = "all";
  if (playerFilter) playerFilter.value = "all";
  renderSpringSeason();
  requestAnimationFrame(() => {
    const card = $$("[data-spring-matchup-id]").find(
      (item) => item.dataset.springMatchupId === matchupId,
    );
    if (!card) return;
    card.open = true;
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
function normalizeSpringPlayer(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
function openSpringPlayerMatches(playerName) {
  const filter = $("#springPlayerFilter"),
    key = normalizeSpringPlayer(playerName);
  if (!filter || !key) return;
  filter.value = key;
  renderSpringSeason();
  requestAnimationFrame(() =>
    $(".fall-results-section")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    }),
  );
}
function renderSpringJourney(teamMap) {
  const panel = $("#springSeasonJourney");
  if (!panel || !springSeasonData) return;
  const weeklyStages = ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
    linesByMatchup = new Map(),
    weekDates = {};
  (springSeasonData.weeks || []).forEach((week) => {
    const stage = canonicalStage(week.weekId);
    if (weeklyStages.includes(stage)) weekDates[stage] = week.playByAt;
  });
  (springSeasonData.lineMatches || []).forEach((line) => {
    const list = linesByMatchup.get(line.matchupId) || [];
    list.push(line);
    linesByMatchup.set(line.matchupId, list);
  });
  const records = [...teamMap.values()].map((team) => ({
      team,
      weekly: Object.fromEntries(weeklyStages.map((stage) => [stage, 0])),
      opponents: {},
      matchups: {},
      played: 0,
      total: 0,
    })),
    recordsByTeam = new Map();
  records.forEach((record) => recordsByTeam.set(record.team.teamId, record));
  (springSeasonData.matchups || []).forEach((matchup) => {
    const stage = canonicalStage(matchup.weekId);
    if (!weeklyStages.includes(stage)) return;
    weekDates[stage] ||=
      matchup.playByAt || matchup.scheduledEndAt || matchup.scheduledStartAt;
    const home = recordsByTeam.get(matchup.homeTeamId),
      away = recordsByTeam.get(matchup.awayTeamId);
    if (home) {
      home.opponents[stage] = fullTeamName(
        matchup.awayTeamId,
        matchup.awayTeamNameSnapshot,
        teamMap,
      ).replace(/^Team\s+/i, "");
      home.matchups[stage] = matchup.matchupId;
    }
    if (away) {
      away.opponents[stage] = fullTeamName(
        matchup.homeTeamId,
        matchup.homeTeamNameSnapshot,
        teamMap,
      ).replace(/^Team\s+/i, "");
      away.matchups[stage] = matchup.matchupId;
    }
    (linesByMatchup.get(matchup.matchupId) || []).forEach((line) => {
      const homePoints = Number(line.homePoints || 0),
        awayPoints = Number(line.awayPoints || 0);
      if (home) {
        home.weekly[stage] += homePoints;
        home.total += homePoints;
        home.played += 1;
      }
      if (away) {
        away.weekly[stage] += awayPoints;
        away.total += awayPoints;
        away.played += 1;
      }
    });
  });
  records
    .sort(
      (a, b) =>
        b.total - a.total ||
        String(a.team.name).localeCompare(String(b.team.name)),
    )
    .forEach((record, index) => (record.seed = index + 1));
  const standingRows = records
    .map(
      (record) =>
        `<div class="journey-standing-row"><span class="journey-seed">${record.seed}</span><b>${safeText(fullTeamName(record.team.teamId, "", teamMap))}</b>${weeklyStages.map((stage) => `<button type="button" class="journey-week-cell journey-match-link" data-open-spring-matchup="${safeText(record.matchups[stage] || "")}" aria-label="Open ${safeText(fullTeamName(record.team.teamId, "", teamMap))} ${stage} matchup"><b>${record.weekly[stage]}</b><small>vs ${safeText(record.opponents[stage] || "TBD")}</small></button>`).join("")}<strong>${record.total}</strong><span>${record.played ? (record.total / record.played).toFixed(1) : "-"}</span></div>`,
    )
    .join("");
  const stageNames = { QF: "Quarterfinals", SF: "Semifinals", F: "Final" },
    playoffColumns = ["QF", "SF", "F"]
      .map((stage) => {
        const games = (springSeasonData.matchups || [])
          .filter((matchup) => canonicalStage(matchup.weekId) === stage)
          .sort((a, b) =>
            String(a.matchupId).localeCompare(String(b.matchupId)),
          );
        return `<div class="playoff-stage-column"><div class="playoff-stage-title"><b>${stageNames[stage]}</b><span>${games.length} match${games.length === 1 ? "" : "es"}</span></div>${games
          .map((matchup) => {
            const lines = linesByMatchup.get(matchup.matchupId) || [],
              homeWins = lines.filter(
                (line) => line.winnerTeamId === matchup.homeTeamId,
              ).length,
              awayWins = lines.filter(
                (line) => line.winnerTeamId === matchup.awayTeamId,
              ).length,
              winnerId =
                matchup.winnerTeamId ||
                (homeWins > awayWins
                  ? matchup.homeTeamId
                  : awayWins > homeWins
                    ? matchup.awayTeamId
                    : null),
              teamRow = (teamId, wins) =>
                `<div class="${winnerId === teamId ? "playoff-winner" : ""}"><span>${safeText(fullTeamName(teamId, "", teamMap))}</span><b>${wins}</b></div>`;
            return `<article class="playoff-game"><button type="button" class="playoff-match-link" data-open-spring-matchup="${safeText(matchup.matchupId)}">${safeText(matchup.matchupId)}</button>${teamRow(matchup.homeTeamId, homeWins)}${teamRow(matchup.awayTeamId, awayWins)}</article>`;
          })
          .join("")}</div>`;
      })
      .join("");
  panel.innerHTML = `<div class="dashboard-card journey-standings"><div class="journey-card-heading"><div><h3>Regular Season Standings</h3><p>Points earned by week</p></div><span class="badge navy">7 weeks</span></div><div class="journey-table"><div class="journey-standing-row journey-standing-head"><span>Seed</span><span>Team</span>${weeklyStages.map((stage) => `<span>${stage}</span>`).join("")}<span>Total</span><span>Avg</span></div><div class="journey-standing-row journey-date-row"><span></span><b>Play by</b>${weeklyStages.map((stage) => `<span>${safeText(weekDates[stage] ? formatDate(weekDates[stage]) : "TBD")}</span>`).join("")}<span></span><span></span></div>${standingRows}</div></div><div class="dashboard-card playoff-journey"><div class="journey-card-heading"><div><h3>Playoff Path</h3><p>Quarterfinals through the championship</p></div><span class="badge lime">Team Rohit won</span></div><div class="playoff-bracket">${playoffColumns}</div></div>`;
  $$("[data-open-spring-matchup]", panel).forEach((button) =>
    button.addEventListener("click", () =>
      openSpringMatchup(button.dataset.openSpringMatchup),
    ),
  );
}
function springActiveRosterAssignments() {
  const chosen = new Map(),
    priority = (item) =>
      (item.sourceOfTruth === "Spring 2026 match line snapshots" ? 4 : 0) +
      (item.reconciledAt ? 2 : 0) +
      (item.updatedAt ? 1 : 0);
  (springSeasonData?.rosterAssignments || [])
    .filter((item) => item.status === "active")
    .forEach((item) => {
      const key = `${item.teamId}|${Number(item.rankNumber)}`,
        current = chosen.get(key);
      if (!current || priority(item) > priority(current)) chosen.set(key, item);
    });
  return [...chosen.values()];
}
function renderSpringRosters(teamMap) {
  const panel = $("#springRosterTeams");
  if (!panel) return;
  const assignments = springActiveRosterAssignments();
  if (!assignments.length) {
    panel.innerHTML =
      '<div class="dashboard-card empty-state"><b>Spring roster publication is unavailable</b></div>';
    return;
  }
  const byTeam = new Map(),
    weeklyStages = ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
    matchupById = new Map(
      (springSeasonData.matchups || []).map((matchup) => [
        matchup.matchupId,
        matchup,
      ]),
    );
  assignments.forEach((item) => {
    const list = byTeam.get(item.teamId) || [];
    list.push(item);
    byTeam.set(item.teamId, list);
  });
  const playerStats = (item) => {
    const playerIds = new Set(
        [item.playerId, item.originalPlayerId].filter(Boolean),
      ),
      weekly = Object.fromEntries(weeklyStages.map((stage) => [stage, []]));
    let wins = 0,
      losses = 0;
    (springSeasonData.lineMatches || []).forEach((line) => {
      const matchup = matchupById.get(line.matchupId),
        stage = canonicalStage(matchup?.weekId);
      if (!weeklyStages.includes(stage) || !line.winnerTeamId) return;
      const home = (line.homePlayers || []).some((player) =>
          playerIds.has(player.playerId),
        ),
        away = (line.awayPlayers || []).some((player) =>
          playerIds.has(player.playerId),
        );
      if (!home && !away) return;
      const playerTeamId = home ? line.homeTeamId : line.awayTeamId,
        won = line.winnerTeamId === playerTeamId;
      weekly[stage].push(won ? "W" : "L");
      if (won) wins += 1;
      else losses += 1;
    });
    return { weekly, wins, losses, played: wins + losses };
  };
  panel.innerHTML = [...teamMap.values()]
    .sort((a, b) => String(a.teamId).localeCompare(String(b.teamId)))
    .map((team, index) => {
      const roster = (byTeam.get(team.teamId) || []).sort(
        (a, b) => Number(a.rankNumber) - Number(b.rankNumber),
      );
      const captainIds = team.captainPlayerIds || [],
        captain =
          roster.find((item) => captainIds.includes(item.playerId)) ||
          roster.find((item) =>
            String(item.playerNameSnapshot || "")
              .toLowerCase()
              .startsWith(
                String(team.name || "")
                  .replace(/^Team\s+/i, "")
                  .toLowerCase(),
              ),
          );
      const rows = roster
        .map((item) => {
          const replaced =
            item.assignmentType === "replacement" &&
            item.originalPlayerNameSnapshot;
          return `<div class="spring-rank-row"><span>R${Number(item.rankNumber)}</span><div>${replaced ? `<small>${safeText(item.originalPlayerNameSnapshot)}</small><i>→</i>` : ""}<b>${safeText(item.playerNameSnapshot || item.playerId)}</b>${replaced ? "<em>Replacement</em>" : ""}</div></div>`;
        })
        .join("");
      return `<details class="dashboard-card spring-team-card" ${index === 0 ? "open" : ""}><summary><span class="team-mark ${index % 2 ? "orange" : "blue"}">${safeText((team.name || "T").replace(/^Team\s+/i, "")[0])}</span><div><h3>${safeText(team.name || team.teamId)}</h3><small>Captain · ${safeText(captain?.playerNameSnapshot || team.captainNameSnapshot || "Not recorded")}</small></div><span class="badge navy">14 ranks</span></summary><div class="spring-rank-list">${rows}</div></details>`;
    })
    .join("");
}
function renderSpringTeamDashboards(teamMap) {
  const panel = $("#springRosterTeams");
  if (!panel) return;
  const assignments = springActiveRosterAssignments();
  if (!assignments.length) {
    renderSpringRosters(teamMap);
    return;
  }
  const weeklyStages = ["W1", "W2", "W3", "W4", "W5", "W6", "W7"],
    byTeam = new Map(),
    matchupById = new Map(
      (springSeasonData.matchups || []).map((matchup) => [
        matchup.matchupId,
        matchup,
      ]),
    );
  assignments.forEach((item) => {
    const list = byTeam.get(item.teamId) || [];
    list.push(item);
    byTeam.set(item.teamId, list);
  });
  const playerStats = (item) => {
    const normalize = (value) =>
        String(value || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, ""),
      currentName = normalize(item.playerNameSnapshot),
      originalName = normalize(item.originalPlayerNameSnapshot),
      weeklyChoice = Object.fromEntries(
        weeklyStages.map((stage) => [stage, null]),
      ),
      priority = (player) =>
        player.playerId === item.playerId
          ? 4
          : player.playerId === item.originalPlayerId
            ? 3
            : normalize(
                  player.nameSnapshot ||
                    player.playerNameSnapshot ||
                    player.name,
                ) === currentName
              ? 2
              : originalName &&
                  normalize(
                    player.nameSnapshot ||
                      player.playerNameSnapshot ||
                      player.name,
                  ) === originalName
                ? 1
                : 0;
    (springSeasonData.lineMatches || []).forEach((line) => {
      const matchup = matchupById.get(line.matchupId),
        stage = canonicalStage(matchup?.weekId);
      if (!weeklyStages.includes(stage) || !line.winnerTeamId) return;
      const homePriority = Math.max(
          0,
          ...(line.homePlayers || []).map(priority),
        ),
        awayPriority = Math.max(0, ...(line.awayPlayers || []).map(priority)),
        sidePriority = Math.max(homePriority, awayPriority);
      if (!sidePriority || weeklyChoice[stage]?.priority >= sidePriority)
        return;
      weeklyChoice[stage] = {
        priority: sidePriority,
        result:
          line.winnerTeamId ===
          (homePriority >= awayPriority ? line.homeTeamId : line.awayTeamId)
            ? "W"
            : "L",
      };
    });
    const weekly = Object.fromEntries(
        weeklyStages.map((stage) => [
          stage,
          weeklyChoice[stage] ? [weeklyChoice[stage].result] : [],
        ]),
      ),
      wins = weeklyStages.filter((stage) => weekly[stage][0] === "W").length,
      losses = weeklyStages.filter((stage) => weekly[stage][0] === "L").length;
    return { weekly, wins, losses, played: wins + losses };
  };
  panel.innerHTML = [...teamMap.values()]
    .sort((a, b) => String(a.teamId).localeCompare(String(b.teamId)))
    .map((team, index) => {
      const roster = (byTeam.get(team.teamId) || []).sort(
          (a, b) => Number(a.rankNumber) - Number(b.rankNumber),
        ),
        captainIds = team.captainPlayerIds || [],
        captain =
          roster.find((item) => captainIds.includes(item.playerId)) ||
          roster.find((item) =>
            String(item.playerNameSnapshot || "")
              .toLowerCase()
              .startsWith(
                String(team.name || "")
                  .replace(/^Team\s+/i, "")
                  .toLowerCase(),
              ),
          );
      const rows = roster
        .map((item) => {
          const replaced =
              item.assignmentType === "replacement" &&
              item.originalPlayerNameSnapshot,
            stats =
              item.participationOverride === "noMatches"
                ? {
                    weekly: Object.fromEntries(
                      weeklyStages.map((stage) => [stage, []]),
                    ),
                    wins: 0,
                    losses: 0,
                    played: 0,
                  }
                : playerStats(item);
          return `<div class="team-player-stat-row"><span>R${Number(item.rankNumber)}</span><div class="team-player-name">${replaced ? `<small>${safeText(item.originalPlayerNameSnapshot)}</small><i>→</i>` : ""}<b>${safeText(item.playerNameSnapshot || item.playerId)}</b>${replaced ? "<em>Replacement</em>" : ""}</div>${weeklyStages
            .map((stage) => {
              const result = stats.weekly[stage];
              return `<span class="player-week-result ${result.includes("W") ? "win" : result.includes("L") ? "loss" : "empty"}">${result.length ? result.join("/") : "—"}</span>`;
            })
            .join(
              "",
            )}<strong>${stats.played}</strong><strong>${stats.wins}</strong><strong>${stats.losses}</strong></div>`;
        })
        .join("");
      return `<details class="dashboard-card spring-team-card" ${index === 0 ? "open" : ""}><summary><span class="team-mark ${index % 2 ? "orange" : "blue"}">${safeText((team.name || "T").replace(/^Team\s+/i, "")[0])}</span><div><h3>${safeText(team.name || team.teamId)}</h3><small>Captain · ${safeText(captain?.playerNameSnapshot || team.captainNameSnapshot || "Not recorded")}</small></div><span class="badge navy">14 ranks</span></summary><div class="team-player-dashboard"><div class="team-player-stat-row team-player-stat-head"><span>Rank</span><span>Player</span>${weeklyStages.map((stage) => `<span>${stage}</span>`).join("")}<span>Played</span><span>Wins</span><span>Losses</span></div>${rows}</div></details>`;
    })
    .join("");
  const orderedTeams = [...teamMap.values()].sort((a, b) =>
    String(a.teamId).localeCompare(String(b.teamId)),
  );
  $$(".spring-team-card", panel).forEach((card, index) => {
    const captainName = orderedTeams[index]?.captainNameSnapshot,
      caption = card.querySelector("summary small");
    if (captainName && caption)
      caption.textContent = `Captain · ${captainName}`;
  });
  $$(".team-player-name", panel).forEach((container) => {
    const current = container.querySelector("b"),
      original = container.querySelector("small");
    if (current) {
      const name = current.textContent.trim();
      current.outerHTML = `<button type="button" class="team-player-link" data-spring-player-link="${safeText(name)}">${safeText(name)}</button>`;
    }
    if (original) {
      const name = original.textContent.trim();
      original.outerHTML = `<button type="button" class="team-player-link original-player-link" data-spring-player-link="${safeText(name)}">${safeText(name)}</button>`;
    }
  });
  $$("[data-spring-player-link]", panel).forEach((button) =>
    button.addEventListener("click", () =>
      openSpringPlayerMatches(button.dataset.springPlayerLink),
    ),
  );
}
function renderSpringSeason() {
  const panel = $("#springSeasonResults");
  if (!panel) return;
  if (!historyDataLoaded) {
    panel.innerHTML =
      '<div class="dashboard-card empty-state"><b>Loading Spring 2026 from Firebase…</b></div>';
    return;
  }
  if (!springSeasonData) {
    panel.innerHTML =
      '<div class="dashboard-card empty-state"><b>Spring 2026 results are unavailable</b><p>Published results will appear here automatically.</p></div>';
    return;
  }
  const teamMap = new Map(
      (springSeasonData.teams || []).map((team) => [team.teamId, team]),
    ),
    linesByMatchup = new Map();
  springLineEditIndex = new Map();
  renderSpringJourney(teamMap);
  renderSpringTeamDashboards(teamMap);
  const teamFilter = $("#springTeamFilter"),
    weekFilter = $("#springWeekFilter"),
    playerFilter = $("#springPlayerFilter"),
    selectedTeam = teamFilter?.value || "all",
    selectedWeek = weekFilter?.value || "all",
    selectedPlayer = playerFilter?.value || "all";
  if (teamFilter) {
    teamFilter.innerHTML = `<option value="all">All teams</option>${[
      ...teamMap.values(),
    ]
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(
        (team) =>
          `<option value="${safeText(team.teamId)}">${safeText(fullTeamName(team.teamId, "", teamMap))}</option>`,
      )
      .join("")}`;
    teamFilter.value = teamMap.has(selectedTeam) ? selectedTeam : "all";
  }
  (springSeasonData.lineMatches || []).forEach((line) => {
    const list = linesByMatchup.get(line.matchupId) || [];
    list.push(line);
    linesByMatchup.set(line.matchupId, list);
  });
  const playerNames = new Map();
  (springSeasonData.lineMatches || []).forEach((line) =>
    [...(line.homePlayers || []), ...(line.awayPlayers || [])].forEach(
      (player) => {
        const name =
            player.nameSnapshot ||
            player.playerNameSnapshot ||
            player.name ||
            player.playerId,
          key = normalizeSpringPlayer(name);
        if (key && !playerNames.has(key)) playerNames.set(key, name);
      },
    ),
  );
  if (playerFilter) {
    playerFilter.innerHTML = `<option value="all">All players</option>${[
      ...playerNames.entries(),
    ]
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])))
      .map(
        ([key, name]) =>
          `<option value="${safeText(key)}">${safeText(name)}</option>`,
      )
      .join("")}`;
    playerFilter.value = playerNames.has(selectedPlayer)
      ? selectedPlayer
      : "all";
  }
  const activePlayer = playerFilter?.value || "all",
    matchupMatchesPlayer = (matchup) =>
      activePlayer === "all" ||
      (linesByMatchup.get(matchup.matchupId) || []).some((line) =>
        [...(line.homePlayers || []), ...(line.awayPlayers || [])].some(
          (player) =>
            normalizeSpringPlayer(
              player.nameSnapshot ||
                player.playerNameSnapshot ||
                player.name ||
                player.playerId,
            ) === activePlayer,
        ),
      ),
    matchesFilters = (matchup) =>
      (selectedTeam === "all" ||
        matchup.homeTeamId === selectedTeam ||
        matchup.awayTeamId === selectedTeam) &&
      matchupMatchesPlayer(matchup);
  const stageOrder = [
      "F",
      "SF",
      "QF",
      "W7",
      "W6",
      "W5",
      "W4",
      "W3",
      "W2",
      "W1",
    ],
    grouped = new Map(stageOrder.map((stage) => [stage, []]));
  (springSeasonData.matchups || []).forEach((matchup) => {
    const stage = canonicalStage(matchup.weekId);
    if (!grouped.has(stage)) grouped.set(stage, []);
    grouped.get(stage).push(matchup);
  });
  panel.innerHTML =
    stageOrder
      .filter(
        (stage) =>
          (selectedWeek === "all" || stage === selectedWeek) &&
          (grouped.get(stage) || []).some(matchesFilters),
      )
      .map((stage) => {
        const rows = grouped
          .get(stage)
          .filter(matchesFilters)
          .sort((a, b) =>
            String(a.matchupId).localeCompare(String(b.matchupId)),
          );
        return `<section class="fall-stage"><div class="fall-stage-heading"><h3>${seasonStageTitle(stage)}</h3><span>${rows.length} matchup${rows.length === 1 ? "" : "s"}</span></div><div class="fall-matchups">${rows
          .map((matchup, index) => {
            const home = fullTeamName(
                matchup.homeTeamId,
                matchup.homeTeamNameSnapshot,
                teamMap,
              ),
              away = fullTeamName(
                matchup.awayTeamId,
                matchup.awayTeamNameSnapshot,
                teamMap,
              ),
              lines = (linesByMatchup.get(matchup.matchupId) || []).sort(
                (a, b) => Number(a.lineNumber || 0) - Number(b.lineNumber || 0),
              );
            const homeWins = lines.filter(
                (line) => line.winnerTeamId === matchup.homeTeamId,
              ).length,
              awayWins = lines.filter(
                (line) => line.winnerTeamId === matchup.awayTeamId,
              ).length,
              homeTotalPoints = lines.reduce(
                (sum, line) => sum + Number(line.homePoints || 0),
                0,
              ),
              awayTotalPoints = lines.reduce(
                (sum, line) => sum + Number(line.awayPoints || 0),
                0,
              ),
              completed =
                matchup.status === "completed" || homeWins + awayWins > 0;
            const winnerId =
                matchup.winnerTeamId ||
                (homeWins > awayWins
                  ? matchup.homeTeamId
                  : awayWins > homeWins
                    ? matchup.awayTeamId
                    : null),
              winner = winnerId
                ? fullTeamName(winnerId, "", teamMap)
                : "Result pending",
              label =
                stage === "F"
                  ? "Final"
                  : stage === "SF"
                    ? `SF${index + 1}`
                    : stage === "QF"
                      ? `QF${index + 1}`
                      : `M${index + 1}`;
            const isSuperAdmin =
              accounts[currentAccountKey]?.role === "Super Admin";
            const details = lines.length
              ? lines
                  .map((line) => {
                    const canceled =
                        line.scheduleStatus === "canceled" ||
                        line.scoreStatus === "canceled" ||
                        line.resultType === "canceledAfterClinched",
                      lineWinner = line.winnerTeamId
                        ? fullTeamName(line.winnerTeamId, "", teamMap)
                        : "",
                      pending = [
                        "submitted",
                        "awaitingConfirmation",
                        "disputed",
                        "ecReview",
                        "inProgress",
                      ].includes(line.scoreStatus),
                      matchStatus = canceled
                        ? "Canceled after Clinched"
                        : pending
                          ? "Pending"
                          : line.scheduleStatus === "scheduled" ||
                              line.scoreStatus === "scheduled"
                            ? "Scheduled"
                            : line.winnerTeamId ||
                                line.scheduleStatus === "completed" ||
                                ["published", "locked", "confirmed"].includes(
                                  line.scoreStatus,
                                )
                              ? "Completed"
                              : "Pending",
                      statusClass = canceled
                        ? "gray"
                        : matchStatus === "Completed"
                          ? "lime"
                          : matchStatus === "Scheduled"
                            ? "navy"
                            : "orange",
                      outcomeText = lineWinner
                        ? `${lineWinner} won`
                        : canceled
                          ? "No winner"
                          : "Result pending",
                      lineupId =
                        line.lineupId ||
                        line.lineMatchId ||
                        `${matchup.matchupId}-L${line.lineNumber}`,
                      editKey = `${matchup.matchupId}|${line.lineMatchId}`;
                    springLineEditIndex.set(editKey, { line, matchup });
                    return `<div class="fall-line-result"><div class="fall-line-header"><b>Line ${safeText(line.lineNumber || "")}</b><span>${safeText(lineupId)}</span><span class="badge ${statusClass}">${safeText(matchStatus)}</span></div><div class="fall-line-players"><span>${safeText(playerPair(line.homePlayers))} <em>vs</em> ${safeText(playerPair(line.awayPlayers))}</span><small><b>Played:</b> ${safeText(formatPlayedAt(line.scheduledAt))} &nbsp; <b>Venue:</b> ${safeText(line.venueNameSnapshot || line.venueId || "Not recorded")}</small></div><strong>Score: ${safeText(lineScore(line))}</strong><span class="fall-line-points"><b>${safeText(home)}</b> ${Number(line.homePoints || 0)} pts<br><b>${safeText(away)}</b> ${Number(line.awayPoints || 0)} pts</span><small class="fall-line-outcome">${safeText(outcomeText)}</small>${isSuperAdmin ? `<div class="fall-admin-links"><button type="button" data-edit-spring-line="${safeText(editKey)}">Edit lineup & score</button></div>` : ""}</div>`;
                  })
                  .join("")
              : '<div class="fall-lines-empty">Line scores will appear after they are published in Firebase.</div>';
            return `<details class="dashboard-card fall-match-card" data-spring-matchup-id="${safeText(matchup.matchupId)}"><summary><span class="fall-match-label">${label}</span><span class="fall-match-title"><b>${safeText(home)} <em>vs</em> ${safeText(away)}</b><small>${safeText(matchup.matchupId)}</small></span><span class="fall-team-score">${completed ? `<b>${homeWins}-${awayWins}</b><small>${homeTotalPoints}-${awayTotalPoints} total pts</small>` : "Scheduled"}</span><span class="badge ${completed ? "lime" : "navy"}">${safeText(completed ? `${winner} won` : matchup.status || "Scheduled")}</span></summary><div class="fall-line-details"><div class="fall-details-head"><h4>Match details</h4></div>${details}<div class="fall-points-total"><span>Total points won</span><b>${safeText(home)}: ${homeTotalPoints}</b><b>${safeText(away)}: ${awayTotalPoints}</b></div></div></details>`;
          })
          .join("")}</div></section>`;
      })
      .join("") ||
    '<div class="dashboard-card empty-state"><b>No Spring 2026 matchups found</b></div>';
  $$("[data-edit-spring-line]", panel).forEach((button) =>
    button.addEventListener("click", () => {
      const record = springLineEditIndex.get(button.dataset.editSpringLine);
      if (record) openSpringLineEditor(record.line, record.matchup);
    }),
  );
}

function renderStandings() {
  if (!leagueDataLoaded) {
    if ($("#miniStandings"))
      $("#miniStandings").innerHTML =
        '<p class="muted">Loading Firebase standings…</p>';
    $("#standingsRows").innerHTML =
      '<div class="empty-state compact"><p>Loading Firebase standings…</p></div>';
    return;
  }
  if ($("#miniStandings"))
    $("#miniStandings").innerHTML = standings
      .slice(0, 4)
      .map(
        (x, i) =>
          `<div><span>${i + 1}</span><b>${teamsById.get(x.teamId)?.name || x.teamName}</b><em>${x.adjustedTotal} pts</em></div>`,
      )
      .join("");
  $("#standingsRows").innerHTML = standings
    .map((x, i) => {
      const name = teamsById.get(x.teamId)?.name || x.teamName || x.teamId;
      return `<div class="table-row standings-row"><span class="rank-dot">${i + 1}</span><b><span class="team-mark ${i % 2 ? "orange" : "blue"}">${name.replace(/^Team\s+/i, "")[0]}</span>${name}</b><span>${x.completedMatchups}</span><strong>${x.adjustedTotal}</strong><span class="badge ${x.qualified ? "lime" : "gray"}">${x.qualified ? `Seed ${x.playoffPosition}` : "Outside"}</span></div>`;
    })
    .join("");
}

function renderMatches(filter = "all") {
  if (!$("#matchList")) return;
  if (!leagueDataLoaded) {
    $("#matchList").innerHTML =
      '<div class="empty-state"><b>Loading matches from Firebase…</b></div>';
    return;
  }
  const rows = matchups.filter((x) => filter === "all" || x.weekId === filter);
  $("#matchList").innerHTML = rows.length
    ? rows
        .map((x) => {
          const home = teamName(x.homeTeamId, x.homeTeamNameSnapshot),
            away = teamName(x.awayTeamId, x.awayTeamNameSnapshot),
            homeWin = x.homeTeamPoints > x.awayTeamPoints;
          const dateText =
            x.scheduledStartAt && x.scheduledEndAt
              ? `${formatDate(x.scheduledStartAt)} – ${formatDate(x.scheduledEndAt)}`
              : formatDate(x.scheduledStartAt || x.playByAt);
          return `<article class="dashboard-card match-card"><div class="match-meta"><span class="badge navy">${stageLabel(x.weekId)}</span><span>${dateText}</span><span class="verified-dot">✓ ${x.status === "completed" ? "Completed" : x.status}</span></div><div class="match-score"><div class="${homeWin ? "winner" : ""}"><span class="team-mark blue">${home[0]}</span><b>Team ${home}</b><strong>${x.homeTeamPoints}</strong></div><span>vs</span><div class="${!homeWin ? "winner" : ""}"><span class="team-mark orange">${away[0]}</span><b>Team ${away}</b><strong>${x.awayTeamPoints}</strong></div></div><button class="text-button match-details" data-match="${x.matchupId}">${x.completedLineCount} completed${x.canceledLineCount ? ` · ${x.canceledLineCount} canceled` : ""} →</button></article>`;
        })
        .join("")
    : '<div class="empty-state"><b>No Firebase matches found for this stage</b></div>';
  $$(".match-details").forEach((button) =>
    button.addEventListener("click", () =>
      showToast(
        `${lineMatches.filter((line) => line.matchupId === button.dataset.match).length} line records loaded from Firebase`,
      ),
    ),
  );
}

function renderHistory(account) {
  if (!account.access.includes("player")) return;
  $("#playerIdBadge").textContent = account.playerId || "Not linked";
  $("#historySubtitle").textContent =
    `${account.name} · ${account.playerId || "No Player ID"} · Loaded from Firebase`;
  if (!historyDataLoaded) {
    $("#historyRows").innerHTML =
      '<div class="empty-state"><b>Loading all-season Firebase history…</b></div>';
    return;
  }
  const selectedSeason = $("#historySeasonFilter")?.value || "all";
  const included = historySeasons.filter(
    (item) =>
      selectedSeason === "all" || item.season.seasonId === selectedSeason,
  );
  const rows = included
    .flatMap((item) => {
      const matchupIndex = new Map(
          item.matchups.map((matchup) => [matchup.matchupId, matchup]),
        ),
        seasonTeams = new Map(item.teams.map((team) => [team.teamId, team]));
      const localTeamName = (teamId, snapshot) =>
        (seasonTeams.get(teamId)?.name || snapshot || teamId || "Team").replace(
          /^Team\s+/i,
          "",
        );
      return item.lineMatches
        .filter(
          (line) =>
            line.scoreStatus === "published" &&
            [...(line.homePlayers || []), ...(line.awayPlayers || [])].some(
              (player) => player.playerId === account.playerId,
            ),
        )
        .map((line) => {
          const isHome = (line.homePlayers || []).some(
              (player) => player.playerId === account.playerId,
            ),
            matchup = matchupIndex.get(line.matchupId) || {},
            won =
              line.winnerTeamId ===
              (isHome ? line.homeTeamId : line.awayTeamId),
            points = isHome ? line.homePoints : line.awayPoints,
            sets = (line.sets || [])
              .map(
                (set) =>
                  `${isHome ? set.homeScore : set.awayScore}–${isHome ? set.awayScore : set.homeScore}`,
              )
              .join(", ");
          return {
            seasonId: item.season.seasonId,
            seasonName: item.season.name || item.season.seasonId,
            week: stageLabel(matchup.weekId),
            date: formatDate(line.scheduledAt),
            sortDate: line.scheduledAt?.toDate
              ? line.scheduledAt.toDate().valueOf()
              : new Date(line.scheduledAt || 0).valueOf(),
            teams: `${localTeamName(line.homeTeamId, matchup.homeTeamNameSnapshot)} vs ${localTeamName(line.awayTeamId, matchup.awayTeamNameSnapshot)}`,
            line: `L${line.lineNumber}`,
            sets,
            result: won ? "Win" : "Loss",
            points,
          };
        });
    })
    .sort((a, b) => b.sortDate - a.sortDate);
  const wins = rows.filter((r) => r.result === "Win").length,
    losses = rows.length - wins,
    points = rows.reduce((s, r) => s + Number(r.points || 0), 0);
  const scopeLabel =
    selectedSeason === "all"
      ? "All seasons"
      : included[0]?.season.name || selectedSeason;
  $("#historySummary").innerHTML =
    `<div class="dashboard-card"><span>Matches</span><b>${rows.length}</b><small>${scopeLabel}</small></div><div class="dashboard-card"><span>Wins</span><b>${wins}</b><small>${rows.length ? Math.round((wins / rows.length) * 100) : 0}% win rate</small></div><div class="dashboard-card"><span>Losses</span><b>${losses}</b><small>Official results</small></div><div class="dashboard-card"><span>Points</span><b>${points}</b><small>League points earned</small></div>`;
  $("#historyRows").innerHTML = rows.length
    ? rows
        .map(
          (r) =>
            `<div class="history-row"><div><span>${r.seasonName} · ${r.week} · ${r.date}</span><b>${r.teams} · ${r.line}</b><small>${r.sets}</small></div><span class="badge ${r.result === "Win" ? "lime" : "gray"}">${r.result}</span><strong>${r.points} pts</strong></div>`,
        )
        .join("")
    : `<div class="empty-state"><b>No Firebase match history found</b><p>Completed published matches linked to ${account.playerId || "this account"} will appear here.</p></div>`;
}

function renderFirebaseOnlyStates() {
  if ($("#lineupRows"))
    $("#lineupRows").innerHTML =
      '<div class="empty-state compact"><b>No Firebase lineup selected</b><p>Lineup controls appear after a registered captain is linked to a Fall team and matchup.</p></div>';
  if ($("#rankProgress"))
    $("#rankProgress").innerHTML =
      '<p class="muted">Participation loads from Firebase roster slots.</p>';
  if ($("#approvalRows"))
    $("#approvalRows").innerHTML =
      '<div class="empty-state compact"><b>No Firebase lineup pair ready</b></div>';
}

function initCommunityCarousel() {
  const carousel = $("#communityCarousel"),
    track = $("#communitySlides"),
    slides = $$(".community-slide", carousel),
    dots = $("#communityDots");
  if (!carousel || !track || slides.length < 2) return;
  let current = 0,
    timer = null,
    touchStart = null;
  dots.innerHTML = slides
    .map(
      (_, index) =>
        `<button type="button" aria-label="Show community photo ${index + 1}" data-slide="${index}"></button>`,
    )
    .join("");
  const dotButtons = $$("button", dots);
  const show = (index) => {
    current = (index + slides.length) % slides.length;
    track.style.transform = `translateX(-${current * 100}%)`;
    slides.forEach((slide, i) => {
      slide.classList.toggle("active", i === current);
      slide.setAttribute("aria-hidden", String(i !== current));
    });
    dotButtons.forEach((dot, i) => {
      dot.classList.toggle("active", i === current);
      dot.setAttribute("aria-current", i === current ? "true" : "false");
    });
  };
  const stop = () => {
    if (timer) {
      window.clearInterval(timer);
      timer = null;
    }
  };
  const start = () => {
    stop();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      timer = window.setInterval(() => show(current + 1), 4500);
  };
  $("#communityPrevious").addEventListener("click", () => {
    show(current - 1);
    start();
  });
  $("#communityNext").addEventListener("click", () => {
    show(current + 1);
    start();
  });
  dotButtons.forEach((dot) =>
    dot.addEventListener("click", () => {
      show(Number(dot.dataset.slide));
      start();
    }),
  );
  carousel.addEventListener("mouseenter", stop);
  carousel.addEventListener("mouseleave", start);
  carousel.addEventListener("focusin", stop);
  carousel.addEventListener("focusout", start);
  carousel.addEventListener(
    "touchstart",
    (event) => {
      touchStart = event.changedTouches[0].clientX;
      stop();
    },
    { passive: true },
  );
  carousel.addEventListener(
    "touchend",
    (event) => {
      const distance = event.changedTouches[0].clientX - touchStart;
      if (Math.abs(distance) > 45) show(current + (distance < 0 ? 1 : -1));
      start();
    },
    { passive: true },
  );
  document.addEventListener("visibilitychange", () =>
    document.hidden ? stop() : start(),
  );
  show(0);
  start();
}

function openDrawer() {
  $("#mobileDrawer").classList.add("open");
  $("#scrim").classList.add("show");
}
function closeDrawer() {
  $("#mobileDrawer").classList.remove("open");
  $("#scrim").classList.remove("show");
}

function initials(name) {
  return (name || "Google User")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

window.alphaOpenDataUI = {
  applyLeagueData(data) {
    leagueSeason = data.season || null;
    teamsById = new Map((data.teams || []).map((team) => [team.teamId, team]));
    standings = [...(data.standings || [])].sort(
      (a, b) =>
        Number(a.playoffPosition || 99) - Number(b.playoffPosition || 99),
    );
    const order = (weekId) =>
      /^W\d+$/.test(weekId || "")
        ? Number(weekId.slice(1))
        : { QF: 8, SF: 9, F: 10 }[weekId] || 99;
    matchups = [...(data.matchups || [])].sort(
      (a, b) =>
        order(a.weekId) - order(b.weekId) ||
        a.matchupId.localeCompare(b.matchupId),
    );
    lineMatches = data.lineMatches || [];
    leagueDataLoaded = true;
    if ($("#seasonMatchupCount"))
      $("#seasonMatchupCount").textContent = matchups.length;
    if ($("#seasonLineCount"))
      $("#seasonLineCount").textContent = lineMatches.length;
    if ($("#seasonTeamCount"))
      $("#seasonTeamCount").textContent = teamsById.size;
    renderStandings();
    renderMatches($("#weekFilter")?.value || "all");
    renderHistory(accounts[currentAccountKey]);
  },
  applyHistoryData(seasons) {
    historySeasons = [...(seasons || [])].sort(
      (a, b) =>
        Number(b.season.year || 0) - Number(a.season.year || 0) ||
        String(b.season.term || "").localeCompare(String(a.season.term || "")),
    );
    historyDataLoaded = true;
    springSeasonData =
      historySeasons.find(
        (item) =>
          String(item.season.term || "").toLowerCase() === "spring" &&
          Number(item.season.year) === 2026,
      ) ||
      historySeasons.find((item) =>
        /spring.*2026|2026.*spring/i.test(
          `${item.season.name || ""} ${item.season.seasonId || ""}`,
        ),
      ) ||
      null;
    const filter = $("#historySeasonFilter");
    if (filter) {
      const selected = filter.value || "all";
      filter.innerHTML = `<option value="all">All Seasons</option>${historySeasons.map((item) => `<option value="${item.season.seasonId}">${item.season.name || item.season.seasonId}</option>`).join("")}`;
      filter.value = [...filter.options].some(
        (option) => option.value === selected,
      )
        ? selected
        : "all";
    }
    renderHistory(accounts[currentAccountKey]);
    renderSpringSeason();
  },
  showHistoryError(message) {
    historyDataLoaded = true;
    $("#historyRows").innerHTML =
      `<div class="empty-state"><b>Player history unavailable</b><p>${message}</p></div>`;
    renderSpringSeason();
  },
  showError(message) {
    leagueDataLoaded = true;
    if ($("#matchList"))
      $("#matchList").innerHTML =
        `<div class="empty-state"><b>Firebase data could not be loaded</b><p>${message}</p></div>`;
    $("#standingsRows").innerHTML =
      '<div class="empty-state"><b>Firebase standings unavailable</b></div>';
    if ($("#miniStandings"))
      $("#miniStandings").innerHTML =
        '<p class="muted">Firebase standings unavailable.</p>';
  },
};

window.alphaOpenAuthUI = {
  applyUser(user, authorization = {}, announce = false) {
    window.alphaOpenAuthorization = authorization;
    const authorizedAccount = {
      name: user.displayName || user.email || "Google User",
      email: user.email || "",
      avatar: initials(user.displayName || user.email),
      role: authorization.role || "Pending approval",
      access: authorization.access || [],
      playerId: authorization.playerId || null,
    };
    accounts.firebaseUser = authorizedAccount;
    setAccount("firebaseUser", announce);
    $("#authStatus").textContent =
      authorization.status === "active"
        ? "Signed in"
        : authorization.role || "Pending approval";
    if ($("#signInDialog").open) $("#signInDialog").close();
  },
  applyGuest(announce = false) {
    window.alphaOpenAuthorization = null;
    delete accounts.firebaseUser;
    setAccount("guest", announce);
    $("#authStatus").textContent = "Guest access";
  },
  setStatus(message) {
    $("#authStatus").textContent = message;
  },
  showMessage(message) {
    showToast(message);
  },
  isGuest() {
    return currentAccountKey === "guest";
  },
};

bindRoutes();
$$("[data-admin-panel]").forEach((button) =>
  button.addEventListener("click", () =>
    setAdminPanel(button.dataset.adminPanel),
  ),
);
$("#signInButton").addEventListener("click", () =>
  currentAccountKey === "guest"
    ? $("#signInDialog").showModal()
    : window.dispatchEvent(new CustomEvent("alphaopen:request-signout")),
);
$("#continueGoogle").addEventListener("click", () =>
  window.dispatchEvent(new CustomEvent("alphaopen:request-signin")),
);
$("#weekFilter")?.addEventListener("change", (e) =>
  renderMatches(e.target.value),
);
$("#springWeekFilter")?.addEventListener("change", renderSpringSeason);
$("#springTeamFilter")?.addEventListener("change", renderSpringSeason);
$("#springPlayerFilter")?.addEventListener("change", renderSpringSeason);
$("#historySeasonFilter").addEventListener("change", () =>
  renderHistory(accounts[currentAccountKey]),
);
$("#closeSpringLineEditor")?.addEventListener("click", () =>
  $("#springLineEditor").close(),
);
$("#cancelSpringLineEditor")?.addEventListener("click", () =>
  $("#springLineEditor").close(),
);
$("#springLineEditorForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const matchupId = $("#springEditMatchupId").value,
    lineMatchId = $("#springEditLineId").value,
    record = springLineEditIndex.get(`${matchupId}|${lineMatchId}`);
  if (!record) return;
  const player = (prefix, old = {}) => ({
    ...old,
    playerId: $(`#${prefix}Id`).value.trim(),
    nameSnapshot: $(`#${prefix}Name`).value.trim(),
  });
  const sets = [1, 2, 3]
    .map((number) => {
      const home = $(`#springHomeSet${number}`).value,
        away = $(`#springAwaySet${number}`).value;
      return home === "" || away === ""
        ? null
        : {
            setNumber: number,
            format:
              record.line.sets?.find((set) => Number(set.setNumber) === number)
                ?.format || (number === 3 ? "tiebreakTo12" : "standardSet"),
            homeScore: Number(home),
            awayScore: Number(away),
          };
    })
    .filter(Boolean);
  const homeSetWins = sets.filter(
      (set) => set.homeScore > set.awayScore,
    ).length,
    awaySetWins = sets.filter((set) => set.awayScore > set.homeScore).length;
  const payload = {
    matchupId,
    lineMatchId,
    homeTeamId: record.line.homeTeamId,
    awayTeamId: record.line.awayTeamId,
    homePlayers: [
      player("springHomePlayer1", record.line.homePlayers?.[0]),
      player("springHomePlayer2", record.line.homePlayers?.[1]),
    ],
    awayPlayers: [
      player("springAwayPlayer1", record.line.awayPlayers?.[0]),
      player("springAwayPlayer2", record.line.awayPlayers?.[1]),
    ],
    scheduledAt: $("#springPlayedAt").value || null,
    venueNameSnapshot: $("#springVenueName").value.trim() || null,
    homePoints: Number($("#springHomePoints").value),
    awayPoints: Number($("#springAwayPoints").value),
    sets,
    winnerTeamId:
      homeSetWins > awaySetWins
        ? record.line.homeTeamId
        : awaySetWins > homeSetWins
          ? record.line.awayTeamId
          : null,
  };
  $("#saveSpringLineEditor").disabled = true;
  $("#springLineEditorMessage").textContent =
    "Saving lineup and score to Firebase…";
  window.dispatchEvent(
    new CustomEvent("alphaopen:update-spring-line", { detail: payload }),
  );
});
window.addEventListener("alphaopen:spring-line-updated", (event) => {
  const ok = event.detail?.ok;
  $("#saveSpringLineEditor").disabled = false;
  $("#springLineEditorMessage").textContent = ok
    ? "Lineup and score saved. Refreshing published results…"
    : event.detail?.message || "Update failed.";
  if (ok) {
    setTimeout(() => location.reload(), 700);
  }
});
$("#menuButton").addEventListener("click", openDrawer);
$("#closeDrawer").addEventListener("click", closeDrawer);
$("#scrim").addEventListener("click", closeDrawer);
$("#openRegisteredUsers")?.addEventListener("click", () => {
  setAdminPanel("users");
  $("#registeredUsersCard")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
});

window.addEventListener("hashchange", () =>
  navigate(location.hash.slice(1) || "home"),
);
window.addEventListener("popstate", () =>
  navigate(location.hash.slice(1) || "home"),
);
renderStandings();
renderMatches();
renderFirebaseOnlyStates();
initCommunityCarousel();
setAccount("guest");
navigate(location.hash.slice(1) || "home");

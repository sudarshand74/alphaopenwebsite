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
let activeWorkspaceSeason = null;
let workspacePublicSeasons = [];
let standings = [];
let matchups = [];
let lineMatches = [];
let teamsById = new Map();
let leagueDataLoaded = false;
let historySeasons = [];
let historyDataLoaded = false;
let springSeasonData = null;
let fallSeasonData = null;
let springLineEditIndex = new Map();
let pendingApprovalLineupCount;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
let currentAccountKey = "guest";

function countSubmittedLineups(records = []) {
  return records.reduce(
    (count, matchup) =>
      count +
      (String(matchup.homeLineupStatus || "").toLowerCase() === "submitted" ? 1 : 0) +
      (String(matchup.awayLineupStatus || "").toLowerCase() === "submitted" ? 1 : 0),
    0,
  );
}
window.alphaOpenCountSubmittedLineups = countSubmittedLineups;

function allowed(element, account) {
  const navRoles = (element.dataset.navRoles || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (navRoles.length)
    return account.role === "Super Admin" || navRoles.includes(account.role);
  const strictAccess = element.dataset.accessStrict;
  if (strictAccess) return account.access.includes(strictAccess);
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
  $$("[data-access],[data-access-any],[data-access-strict],[data-nav-roles]").forEach(
    (el) => (el.hidden = !allowed(el, account)),
  );
  $$("[data-super-admin]").forEach(
    (el) => (el.hidden = account.role !== "Super Admin"),
  );
  const requestedRoute = location.hash.slice(1) || "home";
  const requestedView = $(`.view[data-view="${requestedRoute}"]`);
  const active = $(".view.active");
  if ((requestedView && !allowed(requestedView, account)) || (active && !allowed(active, account)))
    navigate("home");
  const historyPlayerFilter = $("#historyPlayerFilter");
  if (historyPlayerFilter)
    historyPlayerFilter.dataset.preferredPlayerId =
      account.access.includes("player") ? account.playerId || "" : "";
  renderWorkspace(account);
  renderHistory(account);
  renderSpringSeason();
  renderFallSeason();
  if (announce)
    showToast(key === "guest" ? "Signed out" : `Signed in as ${account.name}`);
}

function renderWorkspace(account) {
  $("#workspaceKicker").textContent =
    account.role === "Guest" ? "Public league" : `${account.role} workspace`;
  $("#welcomeTitle").textContent =
    account.role === "Guest"
      ? "Welcome to AlphaOpen"
      : `Welcome, ${account.name}`;
  const workspaceIdentity = $("#workspaceIdentity");
  workspaceIdentity.hidden = account.role === "Guest";
  workspaceIdentity.textContent =
    account.role === "Guest"
      ? ""
      : `${account.playerId ? `Player ID: ${account.playerId} · ` : ""}Email: ${account.email}`;
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
  let workspaceCopy = copy[account.role] || copy.Guest;
  if (account.role === "Captain") {
    const memberTeamIds = new Set(account.teamIds || []);
    const assignedTeams = [...teamsById.values()].filter(
      (team) =>
        memberTeamIds.has(team.teamId) ||
        (account.playerId &&
          Array.isArray(team.captainPlayerIds) &&
          team.captainPlayerIds.includes(account.playerId)),
    );
    const assignedLabels = assignedTeams.length
      ? assignedTeams.map((team) => team.name || team.teamId)
      : [...memberTeamIds];
    workspaceCopy = assignedLabels.length
      ? `Your captain account is active for ${assignedLabels.join(", ")} in the active season.`
      : "Your captain account is active; an active-season team assignment is still required.";
  }
  $("#welcomeCopy").textContent = workspaceCopy;
  const activeSeason =
    (activeWorkspaceSeason ? { season: activeWorkspaceSeason } : null) ||
    historySeasons.find(
      (item) => String(item.season?.status || "").toLowerCase() === "active",
    ) || fallSeasonData;
  const activeSeasonRecord = activeSeason?.season || null;
  const activeSeasonRoute =
    String(activeSeasonRecord?.term || "").toLowerCase() === "fall" &&
    Number(activeSeasonRecord?.year) === 2026
      ? "fall2026"
      : "schedule";
  const activeSeasonLabel = activeSeasonRecord
    ? `Active season: ${activeSeasonRecord.seasonId} · ${activeSeasonRecord.name || activeSeasonRecord.seasonId}`
    : "Active season: Loading…";
  const completedSeason = [...workspacePublicSeasons]
    .filter((season) => String(season.status || "").toLowerCase() === "completed")
    .sort(
      (a, b) =>
        String(b.endDate || "").localeCompare(String(a.endDate || "")) ||
        Number(b.year || 0) - Number(a.year || 0),
    )[0];
  const actions = [
    [
      activeSeasonRoute,
      activeSeasonLabel,
      "Click here to see current season’s teams, schedule, ranking and match results.",
    ],
    [
      "matches",
      "Matches",
      "Click here to see today’s, upcoming and recently completed matches and generate posters on the fly.",
    ],
  ];
  if (account.role !== "Super Admin" && account.access.includes("captain"))
    actions.push(["lineup", "Build & Submit Lineup", "Run SOR checks"]);
  if (account.role === "Super Admin" || account.access.includes("approver")) {
    const countIsReady = Number.isFinite(pendingApprovalLineupCount);
    const pendingLineupCount = countIsReady ? pendingApprovalLineupCount : 0;
    const pendingLineupMessage = pendingApprovalLineupCount === undefined
      ? "Checking lineups awaiting your review/approval..."
      : pendingApprovalLineupCount === null
        ? "Pending lineup count is unavailable. Open the review queue to retry."
        : `${pendingLineupCount} ${pendingLineupCount === 1 ? "lineup is" : "lineups are"} awaiting your review/approval`;
    actions.push([
      "approvals",
      "Review/Approve Lineups",
      pendingLineupMessage,
      "",
      countIsReady && pendingLineupCount > 0 ? "pending-approval-alert" : "",
    ]);
  }
  if (account.role === "Super Admin")
    actions.push(["admin", "Season admin", "Manage people and data"]);
  if (account.access.includes("player"))
    actions.push(["history", "My Player History", "View all matches played by me", "my-player-history"]);
  if (completedSeason)
    actions.push([
      "schedule",
      `Past season: ${completedSeason.seasonId} · ${completedSeason.name || completedSeason.seasonId}`,
      "Click here to see Spring 2026 teams, standings, playoffs and match results.",
      "",
      "past-season-action",
    ]);
  $("#quickActions").innerHTML = actions
    .map(
      ([route, title, sub, action, className]) =>
        `<button data-route="${route}"${action ? ` data-home-action="${action}"` : ""}${className ? ` class="${className}"` : ""}><b>${title}</b><small>${sub}</small><span>→</span></button>`,
    )
    .join("");
  $("#quickActions").hidden = actions.length === 0;
  bindRoutes($("#quickActions"));
}

function navigate(route) {
  const target = $(`.view[data-view="${route}"]`);
  if (!target || target.hidden) return;
  mountAdminFeature(route, target);
  if (route === "history" && $("#historySeasonFilter")) {
    $("#historySeasonFilter").value = "all";
    renderHistory(accounts[currentAccountKey]);
  }
  if(route==="ec-roster") mountRosterPanel("ecRosterMount");
  if(route==="admin"&&$("[data-admin-panel].active")?.dataset.adminPanel==="rosters")mountRosterPanel("adminRosterMount");
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
  window.dispatchEvent(
    new CustomEvent("alphaopen:route-changed", { detail: { route } }),
  );
}
function mountRosterPanel(mountId){
  const card=$("#rosterAdminCard"),mount=$(`#${mountId}`);
  if(card&&mount&&!mount.contains(card))mount.appendChild(card);
}
const adminFeaturePanels = {
  "submit-lineup": ["lineup", "adminSubmitLineupMount"],
  "approve-lineup": ["approvals", "adminApproveLineupMount"],
  "update-lineup": ["ec-lineup", "adminUpdateLineupMount"],
  "schedule-score": ["match-management", "adminScheduleScoreMount"],
};
function mountAdminFeature(route, destination) {
  const source = $(`.view[data-view="${route}"]`),
    target = typeof destination === "string" ? $(`#${destination}`) : destination;
  if (!source || !target || (source === target && source.childNodes.length)) return;
  const currentContainer = source.childNodes.length ? source :
    Object.values(adminFeaturePanels)
      .map(([, mountId]) => $(`#${mountId}`))
      .find((mount) => mount && mount.childNodes.length &&
        mount.querySelector(`#${route === "lineup" ? "lineupSeason" : route === "approvals" ? "approvalSeason" : route === "ec-lineup" ? "lineupUpdateSeason" : "matchManagementSeason"}`));
  if (currentContainer && currentContainer !== target)
    target.append(...currentContainer.childNodes);
}

function bindRoutes(root = document) {
  $$("[data-route]", root).forEach((button) => {
    if (!button.dataset.bound) {
      button.dataset.bound = "1";
      button.addEventListener("click", () => {
        if (button.dataset.homeAction === "my-player-history") {
          const playerFilter = $("#historyPlayerFilter"),
            playerId = accounts[currentAccountKey]?.playerId || "";
          if (playerFilter) {
            playerFilter.value = "";
            playerFilter.dataset.preferredPlayerId = playerId;
          }
        }
        navigate(button.dataset.route);
        button.closest("details")?.removeAttribute("open");
      });
    }
  });
}
function setAdminPanel(panel) {
  if(panel==="rosters")mountRosterPanel("adminRosterMount");
  const feature = adminFeaturePanels[panel];
  if (feature) mountAdminFeature(feature[0], feature[1]);
  $$("[data-admin-panel]").forEach((button) =>
    button.classList.toggle("active", button.dataset.adminPanel === panel),
  );
  $$("[data-admin-section]").forEach((section) => {
    const selected = section.dataset.adminSection === panel;
    section.hidden = !selected;
    section.classList.toggle("active", selected);
  });
  window.dispatchEvent(
    new CustomEvent("alphaopen:admin-panel-changed", { detail: { panel } }),
  );
  if (feature)
    window.dispatchEvent(
      new CustomEvent("alphaopen:route-changed", { detail: { route: feature[0], embedded: true } }),
    );
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
    const set = sets.find((item, index) => Number(item.setNumber || index + 1) === number);
    $(`#springHomeSet${number}`).value = set?.homeScore ?? set?.home ?? "";
    $(`#springAwaySet${number}`).value = set?.awayScore ?? set?.away ?? "";
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
function playerPairMarkup(players = [], selectedPlayerId = "") {
  const names = players
    .map((player) => {
      const name =
        player.nameSnapshot ||
        player.playerNameSnapshot ||
        player.name ||
        player.playerId;
      if (!name) return "";
      const escapedName = safeText(name);
      return player.playerId === selectedPlayerId
        ? `<mark class="selected-history-player">${escapedName}</mark>`
        : escapedName;
    })
    .filter(Boolean);
  return names.join(" / ") || "Players TBD";
}
function lineScore(line) {
  return (
    (line.sets || [])
      .filter((set, index) => index < 2 || !(Number(set.homeScore ?? set.home) === 0 && Number(set.awayScore ?? set.away) === 0))
      .map((set) => `${set.homeScore ?? set.home ?? "–"}-${set.awayScore ?? set.away ?? "–"}`)
      .join("  ") || "Score pending"
  );
}
function matchDetailMarkup(detail) {
  const compactRound = String(detail.week || "Match").replace(/^Week\s+/i, "Week"),
    roundLine = [compactRound, detail.lineLabel].filter(Boolean).join("-");
  return `<div class="match-detail"><div class="match-detail-head"><span>${safeText(detail.seasonName || "Season")}</span><span class="badge ${safeText(detail.badgeClass || detail.statusClass || "gray")}">${safeText(detail.badgeLabel || detail.statusLabel)}</span></div><div class="match-detail-title"><b>${safeText(roundLine)} ${safeText(detail.homeTeam)} vs ${safeText(detail.awayTeam)}</b></div><div class="match-detail-identifiers"><span><b>Matchup ID:</b> ${safeText(detail.matchupId)}</span><span><b>Lineup ID:</b> ${safeText(detail.lineupId)}</span></div><div class="match-detail-meta"><span><b>Played:</b> ${safeText(detail.playedAt)}</span><span><b>Venue:</b> ${safeText(detail.venue)}</span></div><div class="match-detail-team"><strong>${detail.homePlayersMarkup || safeText(detail.homePlayers)}</strong></div><span class="match-detail-versus">VS</span><div class="match-detail-team"><strong>${detail.awayPlayersMarkup || safeText(detail.awayPlayers)}</strong></div><div class="match-detail-result"><span><b>Score:</b> ${safeText(detail.score)}</span><span><b>Pts:</b> ${Number(detail.homePoints || 0)}-${Number(detail.awayPoints || 0)}</span></div><div class="match-detail-status"><span><b>Status:</b> ${safeText(detail.statusLabel)}</span>${detail.outcome ? `<strong>${safeText(detail.outcome)}</strong>` : ""}</div>${detail.actions || ""}</div>`;
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
function openFallMatchup(matchupId) {
  const matchup = (fallSeasonData?.matchups || []).find(
    (item) => item.matchupId === matchupId,
  );
  if (!matchup) return;
  const weekFilter = $("#fallWeekFilter"),
    teamFilter = $("#fallTeamFilter"),
    playerFilter = $("#fallPlayerFilter");
  if (weekFilter) weekFilter.value = canonicalStage(matchup.weekId);
  if (teamFilter) teamFilter.value = "all";
  if (playerFilter) playerFilter.value = "all";
  renderFallSeason();
  requestAnimationFrame(() => {
    const root = $(".fall-live-results"),
      card = root
        ? $$("[data-spring-matchup-id]", root).find(
            (item) => item.dataset.springMatchupId === matchupId,
          )
        : null;
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
  openSeasonPlayerMatches(playerName, "springPlayerFilter", ".fall-results-section");
}
function openSeasonPlayerMatches(playerName, filterId, resultsSelector) {
  const filter = $(`#${filterId}`),
    key = normalizeSpringPlayer(playerName);
  if (!filter || !key) return;
  filter.value = key;
  filterId === "fallPlayerFilter" ? renderFallSeason() : renderSpringSeason();
  requestAnimationFrame(() =>
    $(resultsSelector)?.scrollIntoView({
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
    weekDates = {},
    weekStartDates = {},
    lineupSubmissionDates = {};
  (springSeasonData.weeks || []).forEach((week) => {
    const stage = canonicalStage(week.weekId);
    if (weeklyStages.includes(stage)) {
      weekDates[stage] = week.playByAt;
      weekStartDates[stage] = week.startsAt || week.weekStartAt;
      lineupSubmissionDates[stage] =
        week.lineupDeadlineAt || week.lineupSubmissionAt;
    }
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
    weekStartDates[stage] ||=
      matchup.weekStartAt || matchup.scheduledStartAt;
    lineupSubmissionDates[stage] ||= matchup.lineupDeadlineAt;
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
        awayPoints = Number(line.awayPoints || 0),
        isCompleted = Boolean(
          line.winnerTeamId ||
            line.scheduleStatus === "completed" ||
            ["published", "locked", "confirmed"].includes(line.scoreStatus),
        );
      if (home) {
        home.weekly[stage] += homePoints;
        home.total += homePoints;
        if (isCompleted) home.played += 1;
      }
      if (away) {
        away.weekly[stage] += awayPoints;
        away.total += awayPoints;
        if (isCompleted) away.played += 1;
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
  const scheduleRow = (label, dates) =>
    `<div class="journey-standing-row journey-date-row"><span></span><b>${label}</b>${weeklyStages.map((stage) => `<span>${safeText(dates[stage] ? formatDate(dates[stage]) : "TBD")}</span>`).join("")}<span></span><span></span></div>`;
  panel.innerHTML = `<div class="dashboard-card journey-standings"><div class="journey-card-heading"><div><h3>Regular Season Standings</h3><p>Points earned by week</p></div><span class="badge navy">7 weeks</span></div><div class="journey-table"><div class="journey-standing-row journey-standing-head"><span>Seed</span><span>Team</span>${weeklyStages.map((stage) => `<span>${stage}</span>`).join("")}<span>Total</span><span>Avg</span></div>${scheduleRow("Lineup submission", lineupSubmissionDates)}${scheduleRow("Week start", weekStartDates)}${scheduleRow("Play by", weekDates)}${standingRows}</div></div><div class="dashboard-card playoff-journey"><div class="journey-card-heading"><div><h3>Playoff Path</h3><p>Quarterfinals through the championship</p></div><span class="badge lime">Team Rohit won</span></div><div class="playoff-bracket">${playoffColumns}</div></div>`;
  const isFallContext = Boolean(panel.closest('[data-view="fall2026"]'));
  $$("[data-open-spring-matchup]", panel).forEach((button) =>
    button.addEventListener("click", () =>
      isFallContext
        ? openFallMatchup(button.dataset.openSpringMatchup)
        : openSpringMatchup(button.dataset.openSpringMatchup),
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
  const playerFilterId = panel.dataset.seasonPlayerFilter || "springPlayerFilter",
    resultsSelector = panel.dataset.seasonResultsSection || ".fall-results-section";
  $$("[data-spring-player-link]", panel).forEach((button) =>
    button.addEventListener("click", () =>
      openSeasonPlayerMatches(button.dataset.springPlayerLink, playerFilterId, resultsSelector),
    ),
  );
}
function renderFallSeason() {
  const fallResults = $("#fallSeasonResults");
  if (!fallResults) return;
  if (!historyDataLoaded) {
    fallResults.innerHTML = '<div class="dashboard-card empty-state"><b>Loading Fall 2026 from Firebase…</b></div>';
    return;
  }
  if (!fallSeasonData) {
    fallResults.innerHTML = '<div class="dashboard-card empty-state"><b>Fall 2026 setup is not published yet</b><p>Teams and matchups will appear automatically after the season upload.</p></div>';
    return;
  }
  const idPairs = [
      ["springSeasonJourney", "fallSeasonJourney"],
      ["springRosterTeams", "fallRosterTeams"],
      ["springWeekFilter", "fallWeekFilter"],
      ["springTeamFilter", "fallTeamFilter"],
      ["springPlayerFilter", "fallPlayerFilter"],
      ["springStatusFilter", "fallStatusFilter"],
      ["springSeasonResults", "fallSeasonResults"],
    ],
    originalData = springSeasonData;
  idPairs.forEach(([springId, fallId]) => {
    const springElement = $(`#${springId}`), fallElement = $(`#${fallId}`);
    if (springElement) springElement.id = `stored-${springId}`;
    if (fallElement) fallElement.id = springId;
  });
  springSeasonData = fallSeasonData;
  try {
    renderSpringSeason();
    const journey = $("#springSeasonJourney"),
      hasPlayoffs = (fallSeasonData.matchups || []).some((matchup) => ["QF", "SF", "F"].includes(canonicalStage(matchup.weekId)));
    if (journey && !hasPlayoffs) {
      const playoff = $(".playoff-journey", journey);
      if (playoff) playoff.innerHTML = '<div class="journey-card-heading"><div><h3>Playoff Path</h3><p>Quarterfinals through the championship</p></div><span class="badge gray">Not started</span></div><div class="empty-state compact"><b>Playoff matchups will appear after the regular season.</b></div>';
    }
  } finally {
    springSeasonData = originalData;
    [...idPairs].reverse().forEach(([springId, fallId]) => {
      const fallElement = $(`#${springId}`), springElement = $(`#stored-${springId}`);
      if (fallElement) fallElement.id = fallId;
      if (springElement) springElement.id = springId;
    });
  }
  $$(".spring-team-card", $("#fallRosterTeams")).forEach((card) =>
    card.removeAttribute("open"),
  );
}
function renderSeasonDashboard() {
  const panels = $$("#seasonDashboard, #fallSeasonDashboard"),
    panel = panels[0];
  if (!panel) return;
  if (!historyDataLoaded) {
    panel.innerHTML = '<div class="dashboard-card empty-state"><b>Loading Fall 2026 season dashboard from Firebase…</b></div>';
    return;
  }
  if (!fallSeasonData) {
    panel.innerHTML = '<div class="dashboard-card empty-state"><b>Fall 2026 season data is unavailable</b></div>';
    return;
  }
  const teamMap = new Map((fallSeasonData.teams || []).map((team) => [team.teamId, team])),
    weekMap = new Map((fallSeasonData.weeks || []).map((week) => [canonicalStage(week.weekId), week])),
    linesByMatchup = new Map();
  (fallSeasonData.lineMatches || []).forEach((line) => {
    const list = linesByMatchup.get(line.matchupId) || [];
    list.push(line);
    linesByMatchup.set(line.matchupId, list);
  });
  const stageOrder = (stage) => /^W\d+$/.test(stage) ? Number(stage.slice(1)) : ({ QF: 8, SF: 9, F: 10 }[stage] || 99),
    grouped = new Map();
  (fallSeasonData.matchups || []).forEach((matchup) => {
    const stage = canonicalStage(matchup.weekId), list = grouped.get(stage) || [];
    list.push(matchup); grouped.set(stage, list);
  });
  const isTerminal = (line) =>
    ["completed", "canceled"].includes(String(line.scheduleStatus || "").toLowerCase()) ||
    ["published", "locked", "confirmed", "canceled"].includes(String(line.scoreStatus || "").toLowerCase()) ||
    line.resultType === "canceledAfterClinched";
  const summarizeMatchup = (matchup) => {
    const lines = linesByMatchup.get(matchup.matchupId) || [],
      expected = Math.max(Number(matchup.linesPerMatchup || 5), lines.length),
      completed = Math.min(expected, lines.filter(isTerminal).length),
      scheduled = Math.min(
        expected - completed,
        lines.filter((line) =>
          !isTerminal(line) &&
          ["scheduled", "confirmed"].includes(String(line.scheduleStatus || "").toLowerCase()),
        ).length,
      );
    return {
      matchup,
      lines,
      completed,
      scheduled,
      tbs: Math.max(0, expected - completed - scheduled),
      total: expected,
      homePoints: lines.reduce((sum, line) => sum + Number(line.homePoints || 0), 0),
      awayPoints: lines.reduce((sum, line) => sum + Number(line.awayPoints || 0), 0),
    };
  };
  const dateLabel = (value) => value ? formatDate(value, { month: "short", day: "numeric" }) : "TBD",
    teamLabel = (teamId, snapshot) => fullTeamName(teamId, snapshot, teamMap),
    countLink = (value, status, stage, teamId = "") =>
      value > 0
        ? `<button type="button" class="season-dashboard-drill-link" data-dashboard-week="${safeText(stage)}" data-dashboard-status="${safeText(status)}" data-dashboard-team="${safeText(teamId)}" aria-label="View ${value} ${safeText(status)} matches">${value}</button>`
        : "0",
    columnHeader = '<div class="season-dashboard-grid season-dashboard-head"><span>Week</span><span>Start Date</span><span>Play By Date</span><span>Home Team vs Away Team</span><span>Matches Completed</span><span>Matches Scheduled</span><span>Matches TBS</span><span>Total</span><span>Home Team Pts</span><span>Away Team Pts</span></div>',
    weeks = [...grouped.entries()].sort((a, b) => stageOrder(a[0]) - stageOrder(b[0]));
  const weekCards = weeks.map(([stage, matchups]) => {
    const rows = matchups.sort((a, b) => String(a.matchupId).localeCompare(String(b.matchupId))).map(summarizeMatchup),
      week = weekMap.get(stage) || {},
      firstMatchup = rows[0]?.matchup || {},
      startAt = week.startsAt || week.weekStartAt || firstMatchup.weekStartAt || firstMatchup.scheduledStartAt,
      playByAt = week.playByAt || firstMatchup.playByAt || firstMatchup.scheduledEndAt,
      label = /^W\d+$/.test(stage) ? `Week${stage.slice(1)}` : stage,
      totals = rows.reduce((total, row) => ({
        completed: total.completed + row.completed,
        scheduled: total.scheduled + row.scheduled,
        tbs: total.tbs + row.tbs,
        total: total.total + row.total,
        homePoints: total.homePoints + row.homePoints,
        awayPoints: total.awayPoints + row.awayPoints,
      }), { completed: 0, scheduled: 0, tbs: 0, total: 0, homePoints: 0, awayPoints: 0 }),
      hasLineups = rows.some((row) => row.lines.length > 0),
      summary = `<div class="season-dashboard-grid season-dashboard-summary"><b>${safeText(label)} Total</b><span>${safeText(dateLabel(startAt))}</span><span>${safeText(dateLabel(playByAt))}</span><span>${rows.length} matchup${rows.length === 1 ? "" : "s"}</span><strong>${countLink(totals.completed, "completed", stage)}</strong><strong>${countLink(totals.scheduled, "scheduled", stage)}</strong><strong>${countLink(totals.tbs, "toBeScheduled", stage)}</strong><strong>${totals.total}</strong><span></span><span></span></div>`;
    if (!hasLineups) return `<div class="season-dashboard-week no-drilldown">${summary}</div>`;
    const drilldownRows = rows.map((row) => `<div class="season-dashboard-grid season-dashboard-match"><span>${safeText(label)}</span><span>${safeText(dateLabel(row.matchup.weekStartAt || row.matchup.scheduledStartAt || startAt))}</span><span>${safeText(dateLabel(row.matchup.playByAt || row.matchup.scheduledEndAt || playByAt))}</span><b>${safeText(teamLabel(row.matchup.homeTeamId, row.matchup.homeTeamNameSnapshot))} vs ${safeText(teamLabel(row.matchup.awayTeamId, row.matchup.awayTeamNameSnapshot))}</b><span>${countLink(row.completed, "completed", stage, row.matchup.homeTeamId)}</span><span>${countLink(row.scheduled, "scheduled", stage, row.matchup.homeTeamId)}</span><span>${countLink(row.tbs, "toBeScheduled", stage, row.matchup.homeTeamId)}</span><span>${row.total}</span><span>${row.homePoints}</span><span>${row.awayPoints}</span></div>`).join("");
    const totalRow = `<div class="season-dashboard-grid season-dashboard-total"><b>${safeText(label)} Total</b><span></span><span></span><span></span><strong>${totals.completed}</strong><strong>${totals.scheduled}</strong><strong>${totals.tbs}</strong><strong>${totals.total}</strong><span></span><span></span></div>`;
    return `<details class="season-dashboard-week"><summary>${summary}</summary><div class="season-dashboard-drilldown">${drilldownRows}${totalRow}</div></details>`;
  }).join("");
  const grand = weeks.flatMap(([, matchups]) => matchups.map(summarizeMatchup)).reduce((total, row) => ({ completed: total.completed + row.completed, scheduled: total.scheduled + row.scheduled, tbs: total.tbs + row.tbs, total: total.total + row.total, homePoints: total.homePoints + row.homePoints, awayPoints: total.awayPoints + row.awayPoints }), { completed: 0, scheduled: 0, tbs: 0, total: 0, homePoints: 0, awayPoints: 0 });
  panel.innerHTML = `<div class="dashboard-card season-dashboard-card"><div class="journey-card-heading"><div><h2>${safeText(fallSeasonData.season?.name || "AlphaOpen Fall 2026")} Match Tracker</h2><p>Expand a week to view its team matchups. Weeks awaiting all lineups remain summary-only.</p></div><span class="badge navy">${weeks.length} weeks</span></div><div class="season-dashboard-table">${columnHeader}${weekCards}<div class="season-dashboard-grid season-dashboard-grand"><b>Grand Total</b><span></span><span></span><span></span><strong>${grand.completed}</strong><strong>${grand.scheduled}</strong><strong>${grand.tbs}</strong><strong>${grand.total}</strong><span></span><span></span></div></div></div>`;
  panels.slice(1).forEach((target) => target.innerHTML = panel.innerHTML);
  panels.forEach((target) =>
    $$("[data-dashboard-status]", target).forEach((button) =>
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const weekFilter = $("#fallWeekFilter"),
          teamFilter = $("#fallTeamFilter"),
          playerFilter = $("#fallPlayerFilter"),
          statusFilter = $("#fallStatusFilter");
        if (weekFilter) weekFilter.value = button.dataset.dashboardWeek || "all";
        if (teamFilter) teamFilter.value = button.dataset.dashboardTeam || "all";
        if (playerFilter) playerFilter.value = "all";
        if (statusFilter) statusFilter.value = button.dataset.dashboardStatus || "all";
        navigate("fall2026");
        renderFallSeason();
        $(".fall-live-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }),
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
    statusFilter = $("#springStatusFilter"),
    selectedTeam = teamFilter?.value || "all",
    selectedWeek = weekFilter?.value || "all",
    selectedPlayer = playerFilter?.value || "all",
    selectedStatus = statusFilter?.value || "all";
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
    lineFilterStatus = (line) => {
      const scheduleStatus = String(line.scheduleStatus || "").toLowerCase(),
        scoreStatus = String(line.scoreStatus || "").toLowerCase();
      if (scheduleStatus === "canceled" || scoreStatus === "canceled" || line.resultType === "canceledAfterClinched") return "canceled";
      if (line.winnerTeamId || scheduleStatus === "completed" || ["published", "locked", "confirmed"].includes(scoreStatus)) return "completed";
      if (scheduleStatus === "scheduled" || scoreStatus === "scheduled") return "scheduled";
      return "toBeScheduled";
    },
    updateFilterHighlight = (filter, isActive) => {
      filter?.closest("label")?.classList.toggle("active-season-filter", isActive);
      filter?.classList.toggle("active-season-filter-select", isActive);
    },
    playerMarkup = (players = []) =>
      players
        .map((player) => {
          const name = player.nameSnapshot || player.playerNameSnapshot || player.name || player.playerId;
          if (!name) return "";
          const markup = safeText(name);
          return activePlayer !== "all" && normalizeSpringPlayer(name) === activePlayer
            ? `<mark class="selected-season-player">${markup}</mark>`
            : markup;
        })
        .filter(Boolean)
        .join(" / ") || "Players TBD",
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
    matchupMatchesStatus = (matchup) => {
      if (selectedStatus === "all") return true;
      const lines = linesByMatchup.get(matchup.matchupId) || [],
        expected = Number(matchup.linesPerMatchup || 5);
      return lines.some((line) => lineFilterStatus(line) === selectedStatus) ||
        (selectedStatus === "toBeScheduled" && lines.length < expected);
    },
    matchesFilters = (matchup) =>
      (selectedTeam === "all" ||
        matchup.homeTeamId === selectedTeam ||
        matchup.awayTeamId === selectedTeam) &&
      matchupMatchesPlayer(matchup) &&
      matchupMatchesStatus(matchup);
  updateFilterHighlight(weekFilter, selectedWeek !== "all");
  updateFilterHighlight(teamFilter, selectedTeam !== "all");
  updateFilterHighlight(playerFilter, activePlayer !== "all");
  updateFilterHighlight(statusFilter, selectedStatus !== "all");
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
              allLines = (linesByMatchup.get(matchup.matchupId) || []).sort(
                (a, b) => Number(a.lineNumber || 0) - Number(b.lineNumber || 0),
              ),
              visibleLines = allLines.filter((line) =>
                  (activePlayer === "all" ||
                    [...(line.homePlayers || []), ...(line.awayPlayers || [])].some(
                      (player) => normalizeSpringPlayer(player.nameSnapshot || player.playerNameSnapshot || player.name || player.playerId) === activePlayer,
                    )) &&
                  (selectedStatus === "all" || lineFilterStatus(line) === selectedStatus),
                );
            const lines = allLines,
              homeWins = lines.filter(
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
              expectedLineCount = Number(matchup.linesPerMatchup || 5),
              terminalLineCount = lines.filter((line) =>
                ["completed", "canceled"].includes(line.scheduleStatus) ||
                ["published", "locked", "confirmed", "canceled"].includes(line.scoreStatus) ||
                line.resultType === "canceledAfterClinched",
              ).length,
              completed = lines.length >= expectedLineCount && terminalLineCount >= expectedLineCount;
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
            const homeLineupStatus = String(matchup.homeLineupStatus || "notSubmitted").toLowerCase(),
              awayLineupStatus = String(matchup.awayLineupStatus || "notSubmitted").toLowerCase(),
              submittedLineupStatuses = ["submitted", "approved", "published"],
              bothLineupsSubmitted =
                matchup.bothLineupsSubmitted === true ||
                (submittedLineupStatuses.includes(homeLineupStatus) && submittedLineupStatuses.includes(awayLineupStatus)),
              lineupsApproved =
                matchup.lineupsPublished === true ||
                lines.length > 0 ||
                (["approved", "published"].includes(homeLineupStatus) && ["approved", "published"].includes(awayLineupStatus)),
              matchupDisplayStatus = completed
                ? "Completed"
                : lineupsApproved
                  ? "In Progress"
                  : bothLineupsSubmitted
                    ? "Pending Lineup Approval"
                    : "Pending Lineup",
              matchupStatusClass = completed
                ? "lime"
                : matchupDisplayStatus === "In Progress"
                  ? "navy"
                  : "orange";
            const account = accounts[currentAccountKey] || accounts.guest,
              homeNeedsLineup = !submittedLineupStatuses.includes(homeLineupStatus),
              awayNeedsLineup = !submittedLineupStatuses.includes(awayLineupStatus),
              hasBroadLineupAccess = account.role === "Super Admin" || account.access.includes("approver") || account.access.includes("ec"),
              captainTeamIds = account.teamIds || [];
            let submitLineupTeamId = "";
            if (matchupDisplayStatus === "Pending Lineup" && hasBroadLineupAccess) {
              if (homeNeedsLineup) submitLineupTeamId = matchup.homeTeamId;
              else if (awayNeedsLineup) submitLineupTeamId = matchup.awayTeamId;
            } else if (matchupDisplayStatus === "Pending Lineup" && account.access.includes("captain")) {
              if (homeNeedsLineup && captainTeamIds.includes(matchup.homeTeamId)) submitLineupTeamId = matchup.homeTeamId;
              else if (awayNeedsLineup && captainTeamIds.includes(matchup.awayTeamId)) submitLineupTeamId = matchup.awayTeamId;
            }
            const submitLineupAction = submitLineupTeamId
              ? `<button type="button" class="matchup-submit-lineup" data-submit-lineup-matchup="${safeText(matchup.matchupId)}" data-submit-lineup-week="${safeText(stage)}" data-submit-lineup-team="${safeText(submitLineupTeamId)}">Submit Lineup</button>`
              : "";
            const isSuperAdmin =
              accounts[currentAccountKey]?.role === "Super Admin";
            const details = visibleLines.length
              ? visibleLines
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
                        ? "Canceled"
                        : pending
                          ? "Pending"
                          : line.winnerTeamId ||
                              line.scheduleStatus === "completed" ||
                              ["published", "locked", "confirmed"].includes(line.scoreStatus)
                            ? "Completed"
                            : line.scheduleStatus === "scheduled" || line.scoreStatus === "scheduled"
                              ? "Scheduled"
                              : "To Be Scheduled",
                      statusClass = canceled
                        ? "gray"
                        : matchStatus === "Completed"
                          ? "lime"
                          : matchStatus === "Scheduled"
                            ? "navy"
                            : matchStatus === "Pending"
                              ? "orange"
                              : "gray",
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
                    return matchDetailMarkup({
                      seasonName: springSeasonData?.season?.name || "AlphaOpen Spring 2026",
                      week: seasonStageTitle(matchup.weekId),
                      matchupId: matchup.matchupId,
                      homeTeam: home,
                      awayTeam: away,
                      lineLabel: `L${line.lineNumber || ""}`,
                      lineupId,
                      homePlayersMarkup: playerMarkup(line.homePlayers),
                      awayPlayersMarkup: playerMarkup(line.awayPlayers),
                      score: lineScore(line),
                      homePoints: line.homePoints,
                      awayPoints: line.awayPoints,
                      outcome: outcomeText,
                      playedAt: formatPlayedAt(line.scheduledAt),
                      venue: line.venueNameSnapshot || line.venueId || "Not recorded",
                      statusLabel: matchStatus,
                      statusClass,
                      actions: isSuperAdmin ? `<div class="fall-admin-links"><button type="button" data-edit-spring-line="${safeText(editKey)}">Edit lineup & score</button></div>` : "",
                    });
                  })
                  .join("")
              : '<div class="fall-lines-empty">Line scores will appear after they are published in Firebase.</div>';
            return `<details class="dashboard-card fall-match-card" data-spring-matchup-id="${safeText(matchup.matchupId)}"><summary><span class="fall-match-label">${label}</span><span class="fall-match-title"><b>${safeText(home)} <em>vs</em> ${safeText(away)}</b><small>${safeText(matchup.matchupId)}</small></span><span class="fall-team-score"><b>${homeWins}-${awayWins}</b><small>${homeTotalPoints}-${awayTotalPoints} total pts</small></span><span class="matchup-status-actions"><span class="badge ${matchupStatusClass}">${safeText(matchupDisplayStatus)}</span>${submitLineupAction}</span></summary><div class="fall-line-details"><div class="fall-details-head"><h4>Match details</h4></div>${details}<div class="fall-points-total"><span>Total points won</span><b>${safeText(home)}: ${homeTotalPoints}</b><b>${safeText(away)}: ${awayTotalPoints}</b></div></div></details>`;
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
  $$("[data-submit-lineup-matchup]", panel).forEach((button) =>
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      sessionStorage.setItem("alphaopenLineupJump", JSON.stringify({
        matchupId: button.dataset.submitLineupMatchup,
        week: button.dataset.submitLineupWeek,
        teamId: button.dataset.submitLineupTeam,
      }));
      navigate("lineup");
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

function matchesPageDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function matchesPageDateTime(value) {
  const date = matchesPageDate(value);
  return date
    ? date.toLocaleString("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "TBD";
}

function matchesPageTeam(teamId, snapshot) {
  return teamsById.get(teamId)?.name || snapshot || teamId || "TBD";
}

function matchesPagePlayers(players) {
  return (players || [])
    .map((player) => player.nameSnapshot || player.playerNameSnapshot || player.name || player.playerId)
    .filter(Boolean)
    .join(" / ") || "TBD";
}

function matchesPageScore(line) {
  const sets = (line.sets || []).filter(
    (set) => set && !(Number(set.home) === 0 && Number(set.away) === 0),
  );
  return sets.length ? sets.map((set) => `${set.home}-${set.away}`).join(" ") : "—";
}

function matchesPageWeekLine(line, matchup) {
  const weekId = String(matchup.weekId || "");
  const week = /^W\d+$/i.test(weekId)
    ? `Week${weekId.replace(/\D/g, "")}`
    : ({ QF: "Qualifiers", SF: "Semifinals", F: "Finals" }[weekId] || weekId);
  return `${week}-L${line.lineNumber}`;
}

function matchesPageSection(title, subtitle, records, className) {
  const labels = ["Week–Line", "Lineup ID", "Home Team", "Home Team Players", "Away Team", "Away Team Players", "Date & Time", "Venue", "Score", "Home Team Pts", "Away Team Pts"];
  const rows = records
    .map(({ line, matchup }) => {
      const posterReady = ["scheduled", "completed"].includes(line.scheduleStatus);
      const values = [
        matchesPageWeekLine(line, matchup),
        line.lineMatchId || `${matchup.matchupId}-L${line.lineNumber}`,
        matchesPageTeam(matchup.homeTeamId, matchup.homeTeamNameSnapshot),
        matchesPagePlayers(line.homePlayers),
        matchesPageTeam(matchup.awayTeamId, matchup.awayTeamNameSnapshot),
        matchesPagePlayers(line.awayPlayers),
        matchesPageDateTime(line.scheduledAt),
        line.venueNameSnapshot || "TBD",
        matchesPageScore(line),
        Number(line.homePoints || 0),
        Number(line.awayPoints || 0),
      ];
      return `<tr>${values.map((value, index) => index === 1
        ? `<td data-label="${safeText(labels[index])}"><button class="poster-link" type="button" data-public-poster="${safeText(line.lineMatchId || "")}" ${posterReady ? "" : "disabled"}>${safeText(value)}</button></td>`
        : `<td data-label="${safeText(labels[index])}">${safeText(value)}</td>`).join("")}</tr>`;
    })
    .join("");
  return `<section class="dashboard-card match-table-section ${className}">
    <div class="match-table-heading"><div><h2>${safeText(title)}</h2><p>${safeText(subtitle)}</p></div><span class="badge navy">${records.length} matches</span></div>
    ${rows ? `<div class="match-table-scroll"><table class="match-operations-table public-matches-table"><thead><tr>${labels.map((label) => `<th>${safeText(label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state compact"><p>No matches in this section.</p></div>'}
  </section>`;
}

function renderMatchesPage() {
  const panel = $("#matchesPage");
  if (!panel) return;
  const seasonLabel = $("#matchesSeasonLabel");
  if (seasonLabel)
    seasonLabel.textContent = `Season: ${leagueSeason?.name || leagueSeason?.seasonName || leagueSeason?.seasonId || "Active season"}`;
  if (!leagueDataLoaded) {
    panel.innerHTML = '<div class="dashboard-card empty-state"><b>Loading matches from Firebase…</b></div>';
    return;
  }
  const matchupIndex = new Map(matchups.map((matchup) => [matchup.matchupId, matchup]));
  const records = lineMatches
    .map((line) => ({ line, matchup: matchupIndex.get(line.matchupId) }))
    .filter((record) => record.matchup)
    .sort((left, right) => {
      const leftDate = matchesPageDate(left.line.scheduledAt);
      const rightDate = matchesPageDate(right.line.scheduledAt);
      if (leftDate && rightDate) return leftDate - rightDate;
      if (leftDate) return -1;
      if (rightDate) return 1;
      return String(left.matchup.matchupId).localeCompare(String(right.matchup.matchupId)) || Number(left.line.lineNumber) - Number(right.line.lineNumber);
    });
  const today = new Date();
  const sameDay = (date) => date && date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  const todayMatches = records.filter(({ line }) => {
    const status = line.scheduleStatus || "toBeScheduled";
    return !["completed", "canceled"].includes(status) && sameDay(matchesPageDate(line.scheduledAt));
  });
  const upcomingMatches = records.filter(({ line }) => {
    const status = line.scheduleStatus || "toBeScheduled";
    return !["completed", "canceled"].includes(status) && !sameDay(matchesPageDate(line.scheduledAt));
  });
  const completedMatches = records
    .filter(({ line }) => line.scheduleStatus === "completed")
    .sort((left, right) => (matchesPageDate(right.line.scheduledAt)?.getTime() || 0) - (matchesPageDate(left.line.scheduledAt)?.getTime() || 0));
  panel.innerHTML = [
    matchesPageSection("Today’s Matches", "Matches scheduled for today", todayMatches, "today"),
    matchesPageSection("Upcoming Matches", "Scheduled and to-be-scheduled matches", upcomingMatches, "upcoming"),
    matchesPageSection("Completed Matches", "Completed matches with official scores and points", completedMatches, "completed"),
  ].join("");
  const recordIndex = new Map(records.map((record) => [record.line.lineMatchId, record]));
  panel.querySelectorAll("[data-public-poster]").forEach((button) => {
    button.addEventListener("click", () => {
      const record = recordIndex.get(button.dataset.publicPoster);
      if (!record) return;
      const { line, matchup } = record;
      window.dispatchEvent(new CustomEvent("alphaopen:generate-poster", { detail: {
        seasonName: leagueSeason?.name || leagueSeason?.seasonName || leagueSeason?.seasonId || "AlphaOpen",
        matchupId: matchup.matchupId,
        lineupId: line.lineMatchId || `${matchup.matchupId}-L${line.lineNumber}`,
        weekLabel: matchesPageWeekLine(line, matchup).replace(/-L\d+$/, ""),
        lineNumber: line.lineNumber,
        homeTeam: matchesPageTeam(matchup.homeTeamId, matchup.homeTeamNameSnapshot),
        awayTeam: matchesPageTeam(matchup.awayTeamId, matchup.awayTeamNameSnapshot),
        homePlayers: (line.homePlayers || []).map((player) => player.nameSnapshot || player.playerNameSnapshot || player.name || player.playerId),
        awayPlayers: (line.awayPlayers || []).map((player) => player.nameSnapshot || player.playerNameSnapshot || player.name || player.playerId),
        scheduledAt: matchesPageDate(line.scheduledAt)?.toISOString() || null,
        venueName: line.venueNameSnapshot || "Venue TBD",
        venueAddress: line.venueAddressSnapshot || "",
        status: line.scheduleStatus || "toBeScheduled",
        score: matchesPageScore(line),
        homePoints: Number(line.homePoints || 0),
        awayPoints: Number(line.awayPoints || 0),
      }}));
    });
  });
}

/*
function matchesPageDate(value) {
  if (!value) return null;
  const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function matchesPageDateTime(value) {
  const date = matchesPageDate(value);
  return date
    ? date.toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "TBD";
}

function matchesPageTeam(teamId, snapshot) {
  return teamsById.get(teamId)?.name || snapshot || teamId || "TBD";
}

function matchesPagePlayers(players) {
  return (players || []).map((player) => player.nameSnapshot || player.playerNameSnapshot || player.name || player.playerId).filter(Boolean).join(" / ") || "TBD";
}

function matchesPageScore(line) {
  const sets = (line.sets || []).filter((set) => set && !(Number(set.home) === 0 && Number(set.away) === 0));
  return sets.length ? sets.map((set) => `${set.home}-${set.away}`).join(" ") : "—";
}

function matchesPageWeekLine(line, matchup) {
  const weekId = String(matchup.weekId || "");
  const week = /^W\d+$/i.test(weekId) ? `Week${weekId.replace(/\D/g, "")}` : ({ QF: "Qualifiers", SF: "Semifinals", F: "Finals" }[weekId] || weekId);
  return `${week}-L${line.lineNumber}`;
}

function matchesPageSection(title, subtitle, records, className) {
  const labels = ["Week–Line", "Home Team", "Home Team Players", "Away Team", "Away Team Players", "Date & Time", "Venue", "Score", "Home Team Pts", "Away Team Pts"];
  const rows = records.map(({ line, matchup }) => {
    const values = [
      matchesPageWeekLine(line, matchup),
      matchesPageTeam(matchup.homeTeamId, matchup.homeTeamNameSnapshot),
      matchesPagePlayers(line.homePlayers),
      matchesPageTeam(matchup.awayTeamId, matchup.awayTeamNameSnapshot),
      matchesPagePlayers(line.awayPlayers),
      matchesPageDateTime(line.scheduledAt),
      line.venueNameSnapshot || "TBD",
      matchesPageScore(line),
      Number(line.homePoints || 0),
      Number(line.awayPoints || 0),
    ];
    return `<tr>${values.map((value, index) => `<td data-label="${safeText(labels[index])}">${safeText(value)}</td>`).join("")}</tr>`;
  }).join("");
  return `<section class="dashboard-card match-table-section ${className}">
    <div class="match-table-heading"><div><h2>${safeText(title)}</h2><p>${safeText(subtitle)}</p></div><span class="badge navy">${records.length} matches</span></div>
    ${rows ? `<div class="match-table-scroll"><table class="match-operations-table public-matches-table"><thead><tr>${labels.map((label) => `<th>${safeText(label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty-state compact"><p>No matches in this section.</p></div>'}
  </section>`;
}

function renderMatchesPage() {
  const panel = $("#matchesPage");
  if (!panel) return;
  if (!leagueDataLoaded) {
    panel.innerHTML = '<div class="dashboard-card empty-state"><b>Loading matches from Firebase…</b></div>';
    return;
  }
  const matchupIndex = new Map(matchups.map((matchup) => [matchup.matchupId, matchup]));
  const records = lineMatches
    .map((line) => ({ line, matchup: matchupIndex.get(line.matchupId) }))
    .filter((record) => record.matchup)
    .sort((left, right) => {
      const leftDate = matchesPageDate(left.line.scheduledAt);
      const rightDate = matchesPageDate(right.line.scheduledAt);
      if (leftDate && rightDate) return leftDate - rightDate;
      if (leftDate) return -1;
      if (rightDate) return 1;
      return String(left.matchup.matchupId).localeCompare(String(right.matchup.matchupId)) || Number(left.line.lineNumber) - Number(right.line.lineNumber);
    });
  const today = new Date();
  const sameDay = (date) => date && date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
  const todayMatches = records.filter(({ line }) => {
    const status = line.scheduleStatus || "toBeScheduled";
    return !["completed", "canceled"].includes(status) && sameDay(matchesPageDate(line.scheduledAt));
  });
  const upcomingMatches = records.filter(({ line }) => {
    const status = line.scheduleStatus || "toBeScheduled";
    return !["completed", "canceled"].includes(status) && !sameDay(matchesPageDate(line.scheduledAt));
  });
  const completedMatches = records
    .filter(({ line }) => line.scheduleStatus === "completed")
    .sort((left, right) => (matchesPageDate(right.line.scheduledAt)?.getTime() || 0) - (matchesPageDate(left.line.scheduledAt)?.getTime() || 0));
  panel.innerHTML = [
    matchesPageSection("Today’s Matches", "Matches scheduled for today", todayMatches, "today"),
    matchesPageSection("Upcoming Matches", "Scheduled and to-be-scheduled matches", upcomingMatches, "upcoming"),
    matchesPageSection("Completed Matches", "Completed matches with official scores and points", completedMatches, "completed"),
  ].join("");
}

*/
function renderHistory(account) {
  if (!historyDataLoaded) {
    $("#historyRows").innerHTML =
      '<div class="empty-state"><b>Loading all-season Firebase history…</b></div>';
    return;
  }
  const playerIndex = new Map();
  historySeasons.forEach((item) =>
    (item.lineMatches || [])
      .filter((line) => line.scoreStatus === "published")
      .forEach((line) =>
        [...(line.homePlayers || []), ...(line.awayPlayers || [])].forEach(
          (player) => {
            if (!player.playerId) return;
            const name =
              player.nameSnapshot ||
              player.playerNameSnapshot ||
              player.name ||
              player.playerId;
            playerIndex.set(player.playerId, name);
          },
        ),
      ),
  );
  if (account?.playerId && !playerIndex.has(account.playerId))
    playerIndex.set(account.playerId, account.name || account.playerId);
  const playerFilter = $("#historyPlayerFilter"),
    priorPlayerId = playerFilter?.value || "",
    preferredPlayerId = playerFilter?.dataset.preferredPlayerId || "",
    playerOptions = [...playerIndex.entries()].sort((a, b) =>
      a[1].localeCompare(b[1]),
    );
  if (playerFilter) {
    playerFilter.innerHTML = `<option value="">Select a player</option>${playerOptions.map(([playerId, name]) => `<option value="${safeText(playerId)}">${safeText(name)} (${safeText(playerId)})</option>`).join("")}`;
    const nextPlayerId = playerIndex.has(priorPlayerId)
      ? priorPlayerId
      : playerIndex.has(preferredPlayerId)
        ? preferredPlayerId
        : "";
    playerFilter.value = nextPlayerId;
    playerFilter.dataset.preferredPlayerId = "";
  }
  const selectedPlayerId = playerFilter?.value || "",
    selectedPlayerName = playerIndex.get(selectedPlayerId) || "Select a player";
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
        seasonTeams.get(teamId)?.name || snapshot || teamId || "Team";
      return item.lineMatches
        .filter(
          (line) =>
            line.scoreStatus === "published" &&
            selectedPlayerId &&
            [...(line.homePlayers || []), ...(line.awayPlayers || [])].some(
              (player) => player.playerId === selectedPlayerId,
            ),
        )
        .map((line) => {
          const isHome = (line.homePlayers || []).some(
            (player) => player.playerId === selectedPlayerId,
            ),
            matchup = matchupIndex.get(line.matchupId) || {},
            won =
              line.winnerTeamId ===
              (isHome ? line.homeTeamId : line.awayTeamId),
            points = isHome ? line.homePoints : line.awayPoints,
            sets = (line.sets || [])
              .map(
                (set) =>
                  `${isHome ? (set.homeScore ?? set.home) : (set.awayScore ?? set.away)}–${isHome ? (set.awayScore ?? set.away) : (set.homeScore ?? set.home)}`,
              )
              .join(", ");
          return {
            seasonId: item.season.seasonId,
            seasonName: item.season.name || item.season.seasonId,
            matchupId: line.matchupId,
            lineupId:
              line.lineupId ||
              line.lineMatchId ||
              `${line.matchupId}-L${line.lineNumber}`,
            week: stageLabel(matchup.weekId),
            date: formatDate(line.scheduledAt),
            playedAt: formatPlayedAt(line.scheduledAt),
            sortDate: line.scheduledAt?.toDate
              ? line.scheduledAt.toDate().valueOf()
              : new Date(line.scheduledAt || 0).valueOf(),
            homeTeam: localTeamName(
              line.homeTeamId,
              matchup.homeTeamNameSnapshot,
            ),
            awayTeam: localTeamName(
              line.awayTeamId,
              matchup.awayTeamNameSnapshot,
            ),
            line: `L${line.lineNumber}`,
            sets,
            score: lineScore(line),
            venue: line.venueNameSnapshot || line.venueId || "Not recorded",
            homePoints: Number(line.homePoints || 0),
            awayPoints: Number(line.awayPoints || 0),
            homePlayers: playerPair(line.homePlayers),
            awayPlayers: playerPair(line.awayPlayers),
            homePlayersMarkup: playerPairMarkup(
              line.homePlayers,
              selectedPlayerId,
            ),
            awayPlayersMarkup: playerPairMarkup(
              line.awayPlayers,
              selectedPlayerId,
            ),
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
            matchDetailMarkup({
              seasonName: r.seasonName,
              week: r.week,
              matchupId: r.matchupId,
              homeTeam: r.homeTeam,
              awayTeam: r.awayTeam,
              lineLabel: r.line,
              lineupId: r.lineupId,
              homePlayers: r.homePlayers,
              awayPlayers: r.awayPlayers,
              homePlayersMarkup: r.homePlayersMarkup,
              awayPlayersMarkup: r.awayPlayersMarkup,
              score: r.score,
              homePoints: r.homePoints,
              awayPoints: r.awayPoints,
              outcome: "",
              playedAt: r.playedAt,
              venue: r.venue,
              statusLabel: "Completed",
              statusClass: "gray",
              badgeLabel: r.result === "Win" ? "Won" : "Lost",
              badgeClass: r.result === "Win" ? "lime" : "red",
            }),
        )
        .join("")
    : `<div class="empty-state"><b>${selectedPlayerId ? "No Firebase match history found" : "Select a player"}</b><p>${selectedPlayerId ? `Completed published matches linked to ${safeText(selectedPlayerName)} will appear here.` : "Use the Player Name dropdown above to view public match history."}</p></div>`;
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
  applyPublicSeasons(seasons) {
    workspacePublicSeasons = seasons || [];
    renderWorkspace(accounts[currentAccountKey]);
  },
  applyActiveSeason(season) {
    activeWorkspaceSeason = season || null;
    renderWorkspace(accounts[currentAccountKey]);
  },
  applyPendingApprovalCount(count) {
    pendingApprovalLineupCount = count !== null && Number.isFinite(Number(count)) ? Number(count) : null;
    renderWorkspace(accounts[currentAccountKey]);
  },
  applyLeagueData(data) {
    leagueSeason = data.season || null;
    teamsById = new Map((data.teams || []).map((team) => [team.teamId, team]));
    renderWorkspace(accounts[currentAccountKey]);
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
    renderMatchesPage();
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
    fallSeasonData =
      historySeasons.find(
        (item) =>
          String(item.season.term || "").toLowerCase() === "fall" &&
          Number(item.season.year) === 2026,
      ) ||
      historySeasons.find((item) =>
        /fall.*2026|2026.*fall/i.test(
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
    renderWorkspace(accounts[currentAccountKey]);
    renderSpringSeason();
    renderFallSeason();
    renderSeasonDashboard();
  },
  showHistoryError(message) {
    historyDataLoaded = true;
    $("#historyRows").innerHTML =
      `<div class="empty-state"><b>Player history unavailable</b><p>${message}</p></div>`;
    renderSpringSeason();
    renderFallSeason();
    renderSeasonDashboard();
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
    const playerName = authorization.playerName || user.displayName || user.email || "Google User";
    const authorizedAccount = {
      name: playerName,
      email: user.email || "",
      avatar: initials(playerName),
      role: authorization.role || "Pending approval",
      access: authorization.access || [],
      playerId: authorization.playerId || null,
      teamIds: authorization.teamIds || [],
    };
    accounts.firebaseUser = authorizedAccount;
    setAccount("firebaseUser", announce);
    window.dispatchEvent(new CustomEvent("alphaopen:authorization-changed", {
      detail: { user, authorization },
    }));
    $("#authStatus").textContent =
      authorization.status === "active"
        ? "Signed in"
        : authorization.role || "Pending approval";
    if ($("#signInDialog").open) $("#signInDialog").close();
  },
  applyGuest(announce = false) {
    window.alphaOpenAuthorization = null;
    pendingApprovalLineupCount = undefined;
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
$("#springStatusFilter")?.addEventListener("change", renderSpringSeason);
$("#fallWeekFilter")?.addEventListener("change", renderFallSeason);
$("#fallTeamFilter")?.addEventListener("change", renderFallSeason);
$("#fallPlayerFilter")?.addEventListener("change", renderFallSeason);
$("#fallStatusFilter")?.addEventListener("change", renderFallSeason);
$("#historySeasonFilter").addEventListener("change", () =>
  renderHistory(accounts[currentAccountKey]),
);
$("#historyPlayerFilter")?.addEventListener("change", () =>
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
$("#refreshMatches")?.addEventListener("click", () => {
  const button = $("#refreshMatches");
  button.disabled = true;
  button.textContent = "Refreshing…";
  $("#matchesPage").innerHTML =
    '<div class="dashboard-card empty-state"><b>Refreshing matches from Firebase…</b></div>';
  window.dispatchEvent(new CustomEvent("alphaopen:refresh-matches"));
});
window.addEventListener("alphaopen:matches-refreshed", (event) => {
  const button = $("#refreshMatches");
  if (button) {
    button.disabled = false;
    button.textContent = "Refresh";
  }
  if (!event.detail?.ok)
    $("#matchesPage").innerHTML =
      `<div class="dashboard-card empty-state"><b>Matches could not be refreshed</b><p>${event.detail?.message || "Please try again."}</p></div>`;
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

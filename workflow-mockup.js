(() => {
  let fallData = null;
  const teams = { home: [], away: [] };
  const state = {
    status: "pendingSubmission",
    teamAStatus: "Draft saved",
    teamBStatus: "Submitted",
    lines: Array.from({ length: 5 }, (_, i) => ({
      a1: "",
      a2: "",
      b1: "",
      b2: "",
      date: "",
      time: "",
      venue: "",
      scores: ["", "", ""],
    })),
    weekId: "W1",
    matchupId: "AO-F-2026-W1-M1",
    homeTeam: "Team Sunil",
    awayTeam: "Team Parag",
    playByDate: "2026-08-17",
  };
  const $ = (s) => document.querySelector(s),
    esc = (v) =>
      String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const labels = {
      pendingSubmission: "Pending Submission",
      pendingApproval: "Pending Approval",
      toBeScheduled: "To Be Scheduled",
      scheduled: "Scheduled",
      scoreSubmitted: "Score Submitted",
      completed: "Completed",
    },
    order = Object.keys(labels);
  const head = (title, copy) =>
    `<div class="wf-page-head"><div><span class="kicker">Fall 2026 · End-to-end lineup</span><h1>${title}</h1><p>${copy}</p></div><span class="wf-mock-label">Interactive mockup · No Firebase writes</span></div>`;
  const status = () =>
    `<div class="wf-status-track">${order.map((key, i) => `<div class="wf-step ${i < order.indexOf(state.status) ? "done" : key === state.status ? "active" : ""}"><i>${i + 1}</i><span>${labels[key]}</span></div>`).join("")}</div>`;
  const captainMatchups = () =>
    (fallData?.matchups || []).filter(
      (matchup) =>
        matchup.homeTeam === "Team Sunil" || matchup.awayTeam === "Team Sunil",
    );
  const toolbar = () =>
    `<div class="dashboard-card wf-toolbar"><label class="wf-field">Season<select><option>Fall 2026</option></select></label><label class="wf-field">Week<select class="wf-week-select">${captainMatchups().map((matchup) => `<option value="${matchup.weekId}" ${matchup.weekId === state.weekId ? "selected" : ""}>${matchup.weekId.replace("W", "Week ")}</option>`).join("")}</select></label><label class="wf-field">Scheduled opponent<select class="wf-matchup-select">${captainMatchups().map((matchup) => `<option value="${matchup.matchupId}" ${matchup.matchupId === state.matchupId ? "selected" : ""}>${matchup.matchupId} · ${matchup.homeTeam} vs ${matchup.awayTeam}</option>`).join("")}</select></label><span class="badge orange">${labels[state.status]}</span></div>`;
  const options = (players, selected) =>
    players
      .map(
        (name) =>
          `<option ${name === selected ? "selected" : ""}>${esc(name)}</option>`,
      )
      .join("");
  function bindNav(route) {
    document.querySelector(`[data-route="${route}"]`)?.click();
  }
  function renderSubmit() {
    const el = $("#lineupWorkflowSubmit");
    if (!el) return;
    el.innerHTML =
      head(
        "Submit lineup",
        "Captain submits one sealed weekly lineup against the scheduled opponent.",
      ) +
      toolbar() +
      `<div class="dashboard-card">${status()}<div class="wf-team-state"><div><span><b>${state.homeTeam}</b><small>Your lineup · Play by ${state.playByDate}</small></span><span class="badge orange">${state.teamAStatus}</span></div><div><span><b>${state.awayTeam}</b><small>Opponent lineup remains sealed</small></span><span class="badge navy">${state.teamBStatus}</span></div></div><div class="wf-lines"><div class="wf-line-head"><span>Line</span><span>Player one</span><span>Player two</span><span>SOR</span></div>${state.lines.map((line, i) => `<div class="wf-line"><strong>Line ${i + 1}</strong><select data-a1="${i}">${options(teams.home, line.a1)}</select><select data-a2="${i}">${options(teams.home, line.a2)}</select><span class="badge lime">Passed</span></div>`).join("")}</div><div class="wf-audit">One matchup record: ${state.matchupId}. This draft will become the same approved, scheduled, and scored record.</div><div class="wf-actions"><button class="secondary" id="wfSaveDraft">Save draft</button><button class="primary" id="wfSubmit">Submit lineup</button></div></div>`;
    el.querySelectorAll("[data-a1]").forEach(
      (x) => (x.onchange = () => (state.lines[+x.dataset.a1].a1 = x.value)),
    );
    el.querySelectorAll("[data-a2]").forEach(
      (x) => (x.onchange = () => (state.lines[+x.dataset.a2].a2 = x.value)),
    );
    $("#wfSaveDraft").onclick = () => toast("Draft saved in mockup");
    $("#wfSubmit").onclick = () => {
      state.teamAStatus = "Submitted";
      state.status = "pendingApproval";
      renderAll();
      toast("Both lineups are now Pending Approval");
    };
  }
  const side = (name, key) =>
    `<div class="wf-side"><h3>${name}</h3>${state.lines.map((line, i) => `<div class="wf-side-row"><b>Line ${i + 1}</b><span>${esc(line[key + "1"])} / ${esc(line[key + "2"])}<small>SOR validation passed</small></span></div>`).join("")}</div>`;
  function renderApproval() {
    const el = $("#lineupWorkflowApproval");
    if (!el) return;
    el.innerHTML =
      head(
        "Approve lineups",
        "Neutral Approver compares both sealed team submissions before publishing.",
      ) +
      toolbar() +
      `<div class="dashboard-card">${status()}<div class="wf-banner"><span><b>Both teams submitted</b><small>Compare all five lines before approval.</small></span><span class="badge orange">${labels[state.status]}</span></div><div class="wf-compare">${side(state.homeTeam, "a")}<div class="wf-vs">VS</div>${side(state.awayTeam, "b")}</div><div class="wf-actions"><button class="secondary" id="wfReturn">Return for correction</button><button class="primary" id="wfApprove">Approve both lineups</button></div></div>`;
    $("#wfReturn").onclick = () => {
      state.status = "pendingSubmission";
      state.teamAStatus = "Changes requested";
      renderAll();
      toast("Returned to captain");
    };
    $("#wfApprove").onclick = () => {
      state.status = "toBeScheduled";
      renderAll();
      toast("Approved · lines are To Be Scheduled");
    };
  }
  function renderUpdate() {
    const el = $("#lineupWorkflowUpdate");
    if (!el) return;
    const locked = !["pendingSubmission", "pendingApproval"].includes(
      state.status,
    );
    el.innerHTML =
      head(
        "Update lineup",
        "Captains edit before approval; Approver, EC, or Super Admin may edit after approval.",
      ) +
      toolbar() +
      `<div class="dashboard-card">${status()}<div class="wf-banner"><span><b>${locked ? "Approved lineup is locked for Captains" : "Captain editing is available"}</b><small>${locked ? "Neutral Approver, EC, or Super Admin override required." : "Changes return the team submission to draft."}</small></span><span class="badge ${locked ? "navy" : "orange"}">${locked ? "Privileged edit" : "Captain edit"}</span></div>${side(`${state.homeTeam} lineup`, "a")}<div class="wf-actions"><button class="secondary" id="wfAudit">View audit history</button><button class="primary" id="wfPrivileged">${locked ? "Edit with authorized override" : "Save changes"}</button></div><div class="wf-audit">Audit preview: Created by ${state.homeTeam} Captain → submitted → ${labels[state.status]}. Every post-approval edit requires a reason.</div></div>`;
    $("#wfAudit").onclick = () => toast("Audit history opened in mockup");
    $("#wfPrivileged").onclick = () =>
      toast(
        locked ? "Authorized override editor opened" : "Captain changes saved",
      );
  }
  function renderSchedule() {
    const el = $("#lineupWorkflowSchedule");
    if (!el) return;
    el.innerHTML =
      head(
        "Schedule match lines",
        "A playing player or either team Captain can schedule their eligible line.",
      ) +
      toolbar() +
      `<div class="dashboard-card">${status()}<div class="wf-banner"><span><b>Approved lineup · ${labels[state.status]}</b><small>Each permanent line record now receives its date, time, and venue.</small></span></div><div class="wf-schedule-line"><b>Line</b><b>Players</b><b>Date</b><b>Venue</b><b>Status</b></div>${state.lines.map((line, i) => `<div class="wf-schedule-line"><strong>Line ${i + 1}</strong><span>${esc(line.a1)} / ${esc(line.a2)} vs ${esc(line.b1)} / ${esc(line.b2)}</span><input type="datetime-local" data-date="${i}" value="${line.date}"><input placeholder="Venue" data-venue="${i}" value="${esc(line.venue)}"><span class="badge ${line.date ? "lime" : "navy"}">${line.date ? "Scheduled" : "To be scheduled"}</span></div>`).join("")}<div class="wf-actions"><button class="primary" id="wfScheduleSave">Save schedules</button></div></div>`;
    el.querySelectorAll("[data-date]").forEach(
      (x) => (x.onchange = () => (state.lines[+x.dataset.date].date = x.value)),
    );
    el.querySelectorAll("[data-venue]").forEach(
      (x) =>
        (x.onchange = () => (state.lines[+x.dataset.venue].venue = x.value)),
    );
    $("#wfScheduleSave").onclick = () => {
      state.lines.forEach((x, i) => {
        x.date ||= `2026-09-${String(10 + i).padStart(2, "0")}T19:00`;
        x.venue ||= "Wellington Subdivision";
      });
      state.status = "scheduled";
      renderAll();
      toast("Line schedules saved");
    };
  }
  function renderScore() {
    const el = $("#lineupWorkflowScore");
    if (!el) return;
    el.innerHTML =
      head(
        "Update score",
        "Playing players and Captains can submit the initial score; EC and Super Admin control corrections.",
      ) +
      toolbar() +
      `<div class="dashboard-card">${status()}<div class="wf-banner"><span><b>Same permanent matchup and five line records</b><small>After submission, players and Captains are locked out of score changes.</small></span></div><div class="wf-score-line"><b>Line</b><b>Players</b><b>Set 1</b><b>Set 2</b><b>Set 3</b><b>Status</b></div>${state.lines.map((line, i) => `<div class="wf-score-line"><strong>Line ${i + 1}</strong><span>${esc(line.a1)} / ${esc(line.a2)}<br><small>vs ${esc(line.b1)} / ${esc(line.b2)}</small></span>${[0, 1, 2].map((set) => `<input data-score="${i}-${set}" placeholder="6-4" value="${esc(line.scores[set])}" ${state.status === "scoreSubmitted" ? "disabled" : ""}>`).join("")}<span class="badge ${state.status === "scoreSubmitted" ? "orange" : "navy"}">${state.status === "scoreSubmitted" ? "Submitted" : "Ready"}</span></div>`).join("")}<div class="wf-actions"><button class="secondary" id="wfGoSchedule">Schedule lines</button><button class="primary" id="wfScoreSubmit" ${state.status === "scoreSubmitted" ? "disabled" : ""}>Submit scores</button></div><div class="wf-audit">${state.status === "scoreSubmitted" ? "Scores locked. Only EC or Super Admin can correct them now." : "Eligibility is checked per line: playing player, either Captain, EC, or Super Admin."}</div></div>`;
    el.querySelectorAll("[data-score]").forEach(
      (x) =>
        (x.oninput = () => {
          const [i, s] = x.dataset.score.split("-");
          state.lines[+i].scores[+s] = x.value;
        }),
    );
    $("#wfGoSchedule").onclick = () => bindNav("captain-schedule");
    $("#wfScoreSubmit").onclick = () => {
      state.status = "scoreSubmitted";
      renderAll();
      toast("Scores submitted and locked");
    };
  }
  function toast(message) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = message;
    el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2200);
  }
  function renderAll() {
    renderSubmit();
    renderApproval();
    renderUpdate();
    renderSchedule();
    renderScore();
    document.querySelectorAll(".wf-week-select").forEach((select) => {
      select.onchange = () => {
        const matchup = captainMatchups().find(
          (item) => item.weekId === select.value,
        );
        if (matchup) applyMatchup(matchup);
      };
    });
    document.querySelectorAll(".wf-matchup-select").forEach((select) => {
      select.onchange = () => {
        const matchup = captainMatchups().find(
          (item) => item.matchupId === select.value,
        );
        if (matchup) applyMatchup(matchup);
      };
    });
  }
  function applyMatchup(matchup) {
    state.weekId = matchup.weekId;
    state.matchupId = matchup.matchupId;
    state.homeTeam = matchup.homeTeam;
    state.awayTeam = matchup.awayTeam;
    state.playByDate = matchup.playByDate;
    const roster = (teamName) =>
      fallData.rosters
        .filter((player) => player.teamName === teamName)
        .sort((a, b) => a.rank - b.rank)
        .map(
          (player) =>
            `${player.playerId} · ${player.playerName} (R${player.rank})`,
        );
    teams.home = roster(state.homeTeam);
    teams.away = roster(state.awayTeam);
    state.lines.forEach((line, index) => {
      line.a1 = teams.home[index * 2] || "";
      line.a2 = teams.home[index * 2 + 1] || "";
      line.b1 = teams.away[index * 2] || "";
      line.b2 = teams.away[index * 2 + 1] || "";
    });
    renderAll();
  }
  fetch("fall-workflow-data.json")
    .then((response) => response.json())
    .then((data) => {
      fallData = data;
      applyMatchup(captainMatchups()[0]);
    })
    .catch(() => {
      document.querySelectorAll(".wf-mock-label").forEach((label) => {
        label.textContent = "Fall dataset unavailable";
      });
    });
})();

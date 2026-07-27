import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=4";

const byId=id=>document.getElementById(id);
let state=null;

function safe(value){
  return String(value??"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function weekKey(matchup){
  return String(matchup.weekId||matchup.stage||"").trim();
}

function weekLabel(value){
  const key=String(value||"").trim(),upper=key.toUpperCase();
  const regular=upper.match(/^W(?:EEK)?\s*0*(\d+)$/);
  if(regular)return `Week ${Number(regular[1])}`;
  if(["Q","QF","QUALIFIER","QUALIFIERS","QUARTERFINAL","QUARTERFINALS"].includes(upper))return "Qualifier";
  if(["SF","SEMIFINAL","SEMIFINALS"].includes(upper))return "Semifinals";
  if(["F","FINAL","FINALS"].includes(upper))return "Final";
  return key||"Unassigned";
}

function weekOrder(value){
  const label=weekLabel(value),regular=label.match(/^Week (\d+)$/);
  if(regular)return Number(regular[1]);
  if(label==="Qualifier")return 100;
  if(label==="Semifinals")return 110;
  if(label==="Final")return 120;
  return 1000;
}

function teamStatus(value){
  const status=String(value||"").replace(/[\s_-]/g,"").toLowerCase();
  if(["submitted","waitingforopponent","readyforapproval","resubmitted"].includes(status))return "submitted";
  if(["approved","published","locked"].includes(status))return "approved";
  if(["rejected","changesrequested"].includes(status))return "rejected";
  return "pendingSubmission";
}

function overallStatus(matchup,homeStatus,awayStatus){
  const stored=String(matchup.lineupApprovalStatus||"").replace(/[\s_-]/g,"").toLowerCase();
  if(["fullyapproved","approved"].includes(stored))return "fullyApproved";
  if(stored==="rejected")return "rejected";
  if(stored==="awaitingapproval")return "awaitingApproval";
  if(stored==="awaitingsubmission")return "awaitingSubmission";
  if(homeStatus==="rejected"||awayStatus==="rejected")return "rejected";
  if(homeStatus==="approved"&&awayStatus==="approved")return "fullyApproved";
  if(["submitted","approved"].includes(homeStatus)&&["submitted","approved"].includes(awayStatus))return "awaitingApproval";
  return "awaitingSubmission";
}

const labels={
  pendingSubmission:"Pending Submission",
  submitted:"Submitted",
  approved:"Approved",
  rejected:"Rejected",
  awaitingSubmission:"Awaiting Submission",
  awaitingApproval:"Awaiting Approval",
  fullyApproved:"Fully Approved"
};

function badge(status){
  const badgeClass=status==="approved"||status==="fullyApproved"?"lime":status==="submitted"||status==="awaitingApproval"?"orange":status==="rejected"?"orange":"gray";
  return `<span class="badge ${badgeClass}">${safe(labels[status]||status)}</span>`;
}

function teamName(id,snapshot){
  return state.teams.get(id)?.name||snapshot||id||"Team not assigned";
}

function render(){
  const selection=byId("ecStatusWeek").value;
  const dashboard=byId("ecStatusDashboard");
  if(!selection){
    byId("ecStatusMessage").textContent="Select a week or All Weeks to view the dashboard.";
    dashboard.innerHTML='<div class="empty-state"><b>Select Week</b><p>Choose a week or All Weeks to see matchup and lineup approval statuses.</p></div>';
    return;
  }
  const records=state.matchups
    .filter(matchup=>selection==="all"||weekKey(matchup)===selection)
    .sort((a,b)=>weekOrder(weekKey(a))-weekOrder(weekKey(b))||String(a.matchupId).localeCompare(String(b.matchupId)));
  byId("ecStatusMessage").textContent=records.length
    ? `${records.length} matchup${records.length===1?"":"s"} shown for ${selection==="all"?"all weeks":weekLabel(selection)}.`
    : `No matchups found for ${weekLabel(selection)}.`;
  if(!records.length){
    dashboard.innerHTML='<div class="empty-state"><b>No matchups found</b><p>The selected week does not have any matchup records.</p></div>';
    return;
  }
  const rows=records.map(matchup=>{
    const home=teamStatus(matchup.homeLineupStatus),away=teamStatus(matchup.awayLineupStatus),overall=overallStatus(matchup,home,away);
    return `<tr>
      <td data-label="Matchup"><b>${safe(matchup.matchupId)}</b></td>
      <td data-label="Week">${safe(weekLabel(weekKey(matchup)))}</td>
      <td data-label="Home team">${safe(teamName(matchup.homeTeamId,matchup.homeTeamNameSnapshot))}</td>
      <td data-label="Home lineup status">${badge(home)}</td>
      <td data-label="Away team">${safe(teamName(matchup.awayTeamId,matchup.awayTeamNameSnapshot))}</td>
      <td data-label="Away lineup status">${badge(away)}</td>
      <td data-label="Overall approval status">${badge(overall)}</td>
    </tr>`;
  }).join("");
  dashboard.innerHTML=`<div class="ec-lineup-status-table-wrap"><table class="ec-lineup-status-table">
    <thead><tr><th>Matchup ID</th><th>Week</th><th>Home Team</th><th>Home Team Lineup Status</th><th>Away Team</th><th>Away Team Lineup Status</th><th>Overall Approval Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

async function load(user){
  const authorization=window.alphaOpenAuthorization;
  if(!authorization){
    byId("ecStatusMessage").textContent="Waiting for your Captain or EC access profile...";
    return;
  }
  if(
    authorization.role!=="Super Admin" &&
    !authorization.access?.includes("captain") &&
    !authorization.access?.includes("ec")
  )throw new Error("Captain, EC, or Super Admin access is required.");
  const control=await getDoc(doc(db,"systemConfig","seasonControl"));
  const seasonId=authorization.activeSeasonId||control.data()?.activeSeasonId;
  if(!seasonId)throw new Error("No active season is configured.");
  const seasonRef=doc(db,"seasons",seasonId);
  const [seasonSnapshot,teamSnapshot,weekSnapshot,matchupSnapshot]=await Promise.all([
    getDoc(seasonRef),
    getDocs(collection(seasonRef,"teams")),
    getDocs(collection(seasonRef,"weeks")),
    getDocs(collection(seasonRef,"matchups"))
  ]);
  if(!seasonSnapshot.exists())throw new Error("The active season record does not exist.");
  state={
    seasonId,
    season:seasonSnapshot.data(),
    teams:new Map(teamSnapshot.docs.map(item=>[item.id,{teamId:item.id,...item.data()}])),
    matchups:matchupSnapshot.docs.map(item=>({matchupId:item.id,...item.data()}))
  };
  const matchupWeeks=state.matchups.map(weekKey).filter(Boolean);
  const configuredWeeks=weekSnapshot.docs.map(item=>String(item.data().weekId||item.id)).filter(Boolean);
  const weeks=[...new Set([...configuredWeeks,...matchupWeeks])]
    .sort((a,b)=>weekOrder(a)-weekOrder(b)||weekLabel(a).localeCompare(weekLabel(b)));
  byId("ecStatusSeason").innerHTML=`<option value="${safe(seasonId)}">${safe(state.season.name||seasonId)}</option>`;
  byId("ecStatusWeek").innerHTML='<option value="">Select Week</option><option value="all">All Weeks</option>'+
    weeks.map(value=>`<option value="${safe(value)}">${safe(weekLabel(value))}</option>`).join("");
  byId("ecStatusWeek").value="";
  render();
}

function showError(error){
  byId("ecStatusMessage").textContent=error.message||"The dashboard could not be loaded.";
  byId("ecStatusDashboard").innerHTML=`<div class="empty-state"><b>Dashboard unavailable</b><p>${safe(error.message||"Please refresh and try again.")}</p></div>`;
}

byId("ecStatusWeek").addEventListener("change",render);
onAuthStateChanged(auth,user=>{
  if(!user){
    byId("ecStatusMessage").textContent="Sign in as a Captain, EC, or Super Admin.";
    return;
  }
  if(window.alphaOpenAuthorization)load(user).catch(showError);
});
window.addEventListener("alphaopen:profile-ready",()=>{
  if(auth.currentUser)load(auth.currentUser).catch(showError);
});
window.addEventListener("alphaopen:authorization-changed",event=>{
  if(event.detail?.user)load(event.detail.user).catch(showError);
});

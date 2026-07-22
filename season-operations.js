import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, getFirestore } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const config={projectId:"alphaopen-development-2026",appId:"1:128657830722:web:07c8c84d0386b5b11c4edb",storageBucket:"alphaopen-development-2026.firebasestorage.app",apiKey:"AIzaSyCBxY1bOkhALp1W_1yXFmDo9jdFhRNQqIY",authDomain:"alphaopen-development-2026.firebaseapp.com",messagingSenderId:"128657830722"};
const app=getApps().length?getApp():initializeApp(config),auth=getAuth(app),db=getFirestore(app),$=selector=>document.querySelector(selector);
const esc=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const date=value=>{const item=value?.toDate?value.toDate():value?new Date(value):null;return item&&!Number.isNaN(item.valueOf())?new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric"}).format(item):"—";};
let state=null;

async function loadActiveSeason(){
  const user=auth.currentUser;if(!user)return;
  const control=await getDoc(doc(db,"systemConfig","seasonControl")),seasonId=control.data()?.activeSeasonId;if(!seasonId)return;
  const seasonRef=doc(db,"seasons",seasonId),memberRef=doc(seasonRef,"members",user.uid);
  const [seasonSnap,memberSnap,teamsSnap,assignmentsSnap,slotsSnap,matchupsSnap]=await Promise.all([getDoc(seasonRef),getDoc(memberRef),getDocs(collection(seasonRef,"teams")),getDocs(collection(seasonRef,"rosterAssignments")),getDocs(collection(seasonRef,"rosterSlots")),getDocs(collection(seasonRef,"matchups"))]);
  state={seasonId,season:seasonSnap.data(),member:memberSnap.data()||null,teams:teamsSnap.docs.map(item=>({teamId:item.id,...item.data()})),assignments:assignmentsSnap.docs.map(item=>({assignmentId:item.id,...item.data()})),slots:slotsSnap.docs.map(item=>({slotId:item.id,...item.data()})),matchups:matchupsSnap.docs.map(item=>({matchupId:item.id,...item.data()}))};
  renderRoster();renderCaptainSchedule();renderCaptainReadiness();
  window.alphaOpenSeasonState=state;window.dispatchEvent(new CustomEvent("alphaopen:season-data",{detail:state}));
}
function renderRoster(filter=$("#rosterSearch")?.value||""){
  if(!state||!$("#rosterRows"))return;const term=filter.trim().toLowerCase(),teams=new Map(state.teams.map(team=>[team.teamId,team]));
  const rows=state.assignments.filter(item=>item.status==="active").sort((a,b)=>(teams.get(a.teamId)?.name||"").localeCompare(teams.get(b.teamId)?.name||"")||a.rankNumber-b.rankNumber).filter(item=>!term||[item.playerNameSnapshot,item.playerId,teams.get(item.teamId)?.name,item.rankNumber].some(value=>String(value??"").toLowerCase().includes(term)));
  $("#rosterRows").innerHTML=rows.map(item=>`<div class="table-row roster-row"><b>${esc(item.playerNameSnapshot||item.playerId)}</b><span>${esc(teams.get(item.teamId)?.name||item.teamId)}</span><strong>R${item.rankNumber}</strong><span>${esc(item.assignmentType||"original")}</span><span class="badge lime">${esc(item.status)}</span></div>`).join("")||'<div class="empty-state compact"><b>No matching Fall roster assignments</b></div>';
}
function renderCaptainSchedule(){
  const panel=$("#captainScheduleRows");if(!panel||!state)return;const teamIds=state.member?.teamIds||[],teams=new Map(state.teams.map(team=>[team.teamId,team]));
  const rows=state.matchups.filter(item=>teamIds.includes(item.homeTeamId)||teamIds.includes(item.awayTeamId)).sort((a,b)=>(a.scheduledStartAt?.seconds||0)-(b.scheduledStartAt?.seconds||0));
  panel.innerHTML=rows.length?rows.map(item=>`<div class="season-admin-row"><div><b>${esc(teams.get(item.homeTeamId)?.name||item.homeTeamNameSnapshot)} vs ${esc(teams.get(item.awayTeamId)?.name||item.awayTeamNameSnapshot)}</b><small>${esc(item.weekId)} · ${date(item.scheduledStartAt)} through ${date(item.playByAt)}</small></div><span class="badge navy">${esc(item.status)}</span></div>`).join(""):'<div class="empty-state compact"><b>No captain team assignment</b><p>Ask the Super Admin to link your registered account to a Fall team.</p></div>';
}
function renderCaptainReadiness(){const panel=$("#captainReadiness");if(!panel||!state)return;panel.innerHTML=state.teams.map(team=>`<div class="season-admin-row"><div><b>${esc(team.name)}</b><small>${esc((team.captainPlayerIds||[]).join(", "))}</small></div><span class="badge ${(team.captainUids||[]).length?"lime":"orange"}">${(team.captainUids||[]).length?"Registered":"Awaiting captain sign-in"}</span></div>`).join("");}

window.addEventListener("alphaopen:profile-ready",()=>loadActiveSeason().catch(error=>console.error("Active season load failed",error)));
if(window.alphaOpenProfileReady?.status==="ready")loadActiveSeason().catch(error=>console.error("Active season load failed",error));
$("#rosterSearch")?.addEventListener("input",event=>renderRoster(event.target.value));

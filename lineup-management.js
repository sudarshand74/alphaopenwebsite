import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, getFirestore, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const config={projectId:"alphaopen-development-2026",appId:"1:128657830722:web:07c8c84d0386b5b11c4edb",storageBucket:"alphaopen-development-2026.firebasestorage.app",apiKey:"AIzaSyCBxY1bOkhALp1W_1yXFmDo9jdFhRNQqIY",authDomain:"alphaopen-development-2026.firebaseapp.com",messagingSenderId:"128657830722"};
const app=getApps().length?getApp():initializeApp(config),auth=getAuth(app),db=getFirestore(app),$=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);
let data=null,currentLineup=null,validated=null,users=[];
if($("#lineupRoleBadge"))$("#lineupRoleBadge").textContent="Connecting";
if($("#lineupStateMessage"))$("#lineupStateMessage").textContent="Connecting to active-season data...";

const activeAssignments=teamId=>(data?.assignments||[]).filter(x=>x.teamId===teamId&&x.status==="active").sort((a,b)=>Number(a.rankNumber)-Number(b.rankNumber));
const isApprover=()=>Boolean(data?.approvers.some(x=>x.approverUid===auth.currentUser?.uid&&x.status==="active"));
const isSeasonManager=()=>Boolean(window.alphaOpenAuthorization?.access?.includes("ec")||auth.currentUser?.email?.toLowerCase()==="sudarshandesai74@gmail.com");
const isCaptainFor=teamId=>Boolean(data?.member?.roles?.includes("captain")&&data.member.teamIds?.includes(teamId));
const canSubmit=teamId=>isApprover()||isSeasonManager()||isCaptainFor(teamId);
const selectedMatchup=()=>data?.matchups.find(x=>x.matchupId===$("#lineupMatchup")?.value);
const selectedTeam=()=>$("#lineupTeam")?.value||"";
const matchupWeekKey=matchup=>{const stage=String(matchup.stage||"").toLowerCase();if(stage==="final")return"F";if(stage==="semifinal")return"SF";if(stage==="quarterfinal")return"QF";const raw=String(matchup.weekId||matchup.weekName||"").toUpperCase().replace(/\s+/g,"");const number=raw.match(/\d+/)?.[0];return number?`W${number}`:raw;};
const weekLabel=key=>["QF","SF","F"].includes(key)?key:`Week${String(key).replace("W","")}`;

async function load(){
  const user=auth.currentUser;if(!user)return;
  const control=await getDoc(doc(db,"systemConfig","seasonControl")),seasonId=control.data()?.activeSeasonId;if(!seasonId)throw new Error("No active season is configured.");const seasonRef=doc(db,"seasons",seasonId);
  const [season,member,teams,assignments,matchups,ownApprover,rules]=await Promise.all([
    getDoc(seasonRef),getDoc(doc(seasonRef,"members",user.uid)),getDocs(collection(seasonRef,"teams")),getDocs(collection(seasonRef,"rosterAssignments")),getDocs(collection(seasonRef,"matchups")),getDoc(doc(seasonRef,"approverAssignments",user.uid)),getDocs(collection(seasonRef,"ruleVersions"))
  ]);
  if(!season.exists())throw new Error(`Active season ${seasonId} was not found.`);
  data={seasonId,season:season.data()||{},member:member.data()||null,teams:teams.docs.map(x=>({teamId:x.id,...x.data()})),assignments:assignments.docs.map(x=>({assignmentId:x.id,...x.data()})),matchups:matchups.docs.map(x=>({matchupId:x.id,...x.data()})),approvers:ownApprover.exists()?[{assignmentId:ownApprover.id,...ownApprover.data()}]:[],rule:[...rules.docs.map(x=>x.data())].find(x=>x.status==="active")||{}};
  renderBuilderContext();await renderApprovalQueue();
}

function allowedTeams(matchup){
  if(!matchup)return[];const ids=[matchup.homeTeamId,matchup.awayTeamId];return isApprover()||isSeasonManager()?ids:ids.filter(isCaptainFor);
}
function renderBuilderContext(){
  const matchupSelect=$("#lineupMatchup"),teamSelect=$("#lineupTeam"),weekSelect=$("#lineupWeek"),seasonSelect=$("#lineupSeason");if(!matchupSelect||!data)return;
  if(seasonSelect)seasonSelect.innerHTML=`<option value="${esc(data.seasonId)}">${esc(data.season.name||data.seasonId)}</option>`;
  const eligible=data.matchups.filter(m=>allowedTeams(m).length&&!["completed","cancelled"].includes(String(m.status).toLowerCase()));
  const keys=[...new Set(eligible.map(matchupWeekKey).filter(Boolean))].sort((a,b)=>{const order={QF:80,SF:90,F:100};return(order[a]||Number(a.replace("W","")))-(order[b]||Number(b.replace("W","")));});
  weekSelect.innerHTML='<option value="">Select week</option>'+keys.map(key=>`<option value="${esc(key)}">${esc(weekLabel(key))}</option>`).join("");
  const permittedTeamIds=isApprover()||isSeasonManager()?[...new Set(eligible.flatMap(m=>[m.homeTeamId,m.awayTeamId]))]:[...new Set(data.member?.teamIds||[])];
  teamSelect.innerHTML='<option value="">Select team</option>'+permittedTeamIds.map(id=>`<option value="${esc(id)}">${esc(data.teams.find(team=>team.teamId===id)?.name||id)}</option>`).join("");
  if(!isApprover()&&!isSeasonManager()&&permittedTeamIds.length===1)teamSelect.value=permittedTeamIds[0];
  matchupSelect.innerHTML='<option value="">Select matchup</option>';
  $("#lineupRows").innerHTML='<div class="empty-state compact"><b>Select a week and team</b></div>';
  if($("#lineupRoleBadge"))$("#lineupRoleBadge").textContent=isSeasonManager()?"EC / Super Admin":isApprover()?"Season Approver":"Captain";
  $("#saveDraft").disabled=true;$("#validateLineup").disabled=true;$("#submitLineup").disabled=true;
  if(!data.teams.length||!data.matchups.length||!data.assignments.length)setMessage(`Season data incomplete: ${data.teams.length} teams · ${data.matchups.length} matchups · ${data.assignments.length} roster assignments.`);
  else if(!permittedTeamIds.length)setMessage(`Loaded ${data.season.name||data.seasonId}, but your account has no eligible team or approver assignment.`);
  else setMessage(`Loaded ${data.season.name||data.seasonId}: ${data.teams.length} teams · ${data.matchups.length} matchups · ${data.assignments.length} roster assignments. Select a week and team.`);
}
async function resolveLineupContext(){
  const week=$("#lineupWeek")?.value,teamId=selectedTeam(),matchupSelect=$("#lineupMatchup"),summary=$("#lineupMatchupSummary");
  currentLineup=null;validated=null;matchupSelect.innerHTML='<option value="">Select matchup</option>';matchupSelect.value="";
  if(!week||!teamId){if(summary)summary.hidden=true;renderRows([]);setMessage("Select a week and team to begin.");return;}
  const matchup=data.matchups.find(item=>matchupWeekKey(item)===week&&[item.homeTeamId,item.awayTeamId].includes(teamId)&&allowedTeams(item).includes(teamId));
  if(!matchup){if(summary)summary.hidden=true;renderRows([]);setMessage("No eligible matchup exists for that team and week.");return;}
  matchupSelect.innerHTML=`<option value="${esc(matchup.matchupId)}">${esc(matchup.matchupId)}</option>`;matchupSelect.value=matchup.matchupId;
  const opponentId=matchup.homeTeamId===teamId?matchup.awayTeamId:matchup.homeTeamId,opponent=data.teams.find(team=>team.teamId===opponentId)?.name||(matchup.homeTeamId===teamId?matchup.awayTeamNameSnapshot:matchup.homeTeamNameSnapshot)||opponentId;
  $("#lineupMatchupId").textContent=matchup.matchupId;$("#lineupOpponent").textContent=opponent;if(summary)summary.hidden=false;
  await loadLineup();
}
async function loadLineup(){
  const matchup=selectedMatchup(),teamId=selectedTeam();if(!matchup||!teamId)return;
  const snap=await getDoc(doc(db,"seasons",data.seasonId,"matchups",matchup.matchupId,"lineups",teamId));
  currentLineup=snap.exists()?snap.data():null;validated=currentLineup?.status==="systemValidated"?currentLineup.validation:null;
  renderRows(currentLineup?.lines||[]);setMessage(`Status: ${currentLineup?.status||"New draft"}. ${canSubmit(teamId)?"You may manage this lineup.":"Read only."}`);
}
function playerOptions(teamId,selected){return '<option value="">Select player</option>'+activeAssignments(teamId).map(p=>`<option value="${esc(p.playerId)}" ${p.playerId===selected?"selected":""}>R${p.rankNumber} · ${esc(p.playerNameSnapshot||p.playerId)}</option>`).join("");}
function renderRows(lines){
  const panel=$("#lineupRows"),teamId=selectedTeam();if(!panel)return;
  if(!teamId){panel.innerHTML='<div class="empty-state compact"><b>Select a matchup and team</b></div>';return;}
  panel.innerHTML=Array.from({length:5},(_,i)=>{const line=lines[i]||{};return `<div class="lineup-row" data-line="${i+1}"><strong>Line ${i+1}</strong><select data-player="1">${playerOptions(teamId,line.player1Id)}</select><select data-player="2">${playerOptions(teamId,line.player2Id)}</select><span class="badge gray" data-sor>—</span></div>`;}).join("");
  panel.querySelectorAll("select").forEach(x=>x.addEventListener("change",()=>{validated=null;$("#submitLineup").disabled=true;calculateSor();}));calculateSor();
  const locked=currentLineup?.status==="approved";panel.querySelectorAll("select").forEach(x=>x.disabled=locked||!canSubmit(teamId));$("#saveDraft").disabled=locked||!canSubmit(teamId);$("#validateLineup").disabled=locked||!canSubmit(teamId);
}
function collectLines(){const roster=new Map(activeAssignments(selectedTeam()).map(x=>[x.playerId,x]));return [...document.querySelectorAll("#lineupRows .lineup-row")].map((row,i)=>{const ids=[...row.querySelectorAll("select")].map(x=>x.value),a=roster.get(ids[0]),b=roster.get(ids[1]);return{lineNumber:i+1,player1Id:ids[0],player2Id:ids[1],player1Name:a?.playerNameSnapshot||"",player2Name:b?.playerNameSnapshot||"",player1Rank:Number(a?.rankNumber||0),player2Rank:Number(b?.rankNumber||0),sor:Number(a?.rankNumber||0)+Number(b?.rankNumber||0)};});}
function calculateSor(){collectLines().forEach((line,i)=>{const badge=$$("#lineupRows [data-sor]")[i];if(badge)badge.textContent=line.sor||"—";});}
function $$(s){return[...document.querySelectorAll(s)];}
function validate(){
  const lines=collectLines(),errors=[],ids=lines.flatMap(x=>[x.player1Id,x.player2Id]);
  if(lines.length!==5)errors.push("Exactly five lines are required.");
  if(ids.some(x=>!x))errors.push("Every line requires two players.");
  if(new Set(ids.filter(Boolean)).size!==10)errors.push("All ten players must be unique.");
  const restrictions={1:[1,4],4:[7,13],5:[11,14]};
  lines.forEach(line=>{const rule=restrictions[line.lineNumber];if(rule&&[line.player1Rank,line.player2Rank].some(rank=>rank<rule[0]||rank>rule[1]))errors.push(`Line ${line.lineNumber} requires ranks ${rule[0]}–${rule[1]}.`);});
  for(let i=1;i<lines.length;i++)if(lines[i].sor<lines[i-1].sor)errors.push(`Line ${i+1} SOR cannot be lower than Line ${i} SOR.`);
  const result={passed:!errors.length,errors,checkedAt:new Date(),ruleVersionId:data.season.activeRuleVersionId||"v1",checks:{fiveLines:lines.length===5,twoPlayersPerLine:!ids.some(x=>!x),tenUniquePlayers:new Set(ids.filter(Boolean)).size===10,rankRestrictions:!errors.some(x=>x.includes("requires ranks")),nondecreasingSor:!errors.some(x=>x.includes("SOR"))}};
  validated=result;const box=$("#validationBox");box.classList.toggle("valid",result.passed);box.classList.toggle("invalid",!result.passed);box.querySelector("b").textContent=result.passed?"Validation passed":"Validation failed";box.querySelector("small").textContent=result.passed?"All SOR checks passed. Ready to submit.":errors.join(" ");$("#submitLineup").disabled=!result.passed;return result;
}
function setMessage(text){if($("#lineupStateMessage"))$("#lineupStateMessage").textContent=text;}
async function save(status){
  const matchup=selectedMatchup(),teamId=selectedTeam();if(!matchup||!teamId||!canSubmit(teamId))return;
  if(status==="submitted"&&!(validated?.passed))throw new Error("Run validation before submission.");
  const ref=doc(db,"seasons",data.seasonId,"matchups",matchup.matchupId,"lineups",teamId),lines=collectLines(),user=auth.currentUser;
  await runTransaction(db,async tx=>{const old=await tx.get(ref),revision=Number(old.data()?.revisionNumber||0)+1;tx.set(ref,{seasonId:data.seasonId,matchupId:matchup.matchupId,teamId,status,revisionNumber:revision,ruleVersionId:data.season.activeRuleVersionId||"v1",lines,validation:status==="draft"?null:validated,submittedByUid:status==="submitted"?user.uid:old.data()?.submittedByUid||null,submittedAt:status==="submitted"?serverTimestamp():old.data()?.submittedAt||null,updatedByUid:user.uid,updatedAt:serverTimestamp()},{merge:true});});
  setMessage(status==="submitted"?"Lineup submitted for approval.":"Draft saved.");await loadLineup();
}

async function loadApproverAdmin(){
  const select=$("#lineupApproverSeason"),message=$("#lineupApproverMessage");if(!select)return;
  select.innerHTML='<option value="">Loading seasons...</option>';if(message)message.textContent="Loading seasons and registered players...";
  try{
    const seasons=await getDocs(collection(db,"seasons"));
    const activeSeasonId=data?.seasonId||"";select.innerHTML=seasons.docs.sort((a,b)=>Number(b.data().year||0)-Number(a.data().year||0)).map(x=>`<option value="${esc(x.id)}" ${x.id===activeSeasonId?"selected":""}>${esc(x.data().name||x.id)}</option>`).join("");
    if(!select.value&&select.options.length)select.selectedIndex=0;
    if(message)message.textContent=`${seasons.size} seasons loaded. Loading registered players...`;await renderApprovers();
    try{
      const userSnap=await getDocs(collection(db,"users"));users=userSnap.docs.map(x=>({uid:x.id,...x.data()})).filter(x=>x.status==="active"&&x.playerId);
      $("#lineupApproverPlayer").innerHTML='<option value="">Select a registered player</option>'+users.sort((a,b)=>String(a.displayName).localeCompare(String(b.displayName))).map(x=>`<option value="${esc(x.uid)}">${esc(x.displayName||x.email)} · ${esc(x.playerId)}</option>`).join("");
      if(message)message.textContent=`${seasons.size} seasons · ${users.length} registered players available.`;
    }catch(error){if(message)message.textContent=`Seasons loaded. Registered players could not load: ${error.message}`;}
  }catch(error){select.innerHTML='<option value="">Unable to load seasons</option>';if(message)message.textContent=`Season load failed: ${error.message}`;throw error;}
}
async function renderApprovers(){const seasonId=$("#lineupApproverSeason")?.value;if(!seasonId)return;const snap=await getDocs(collection(db,"seasons",seasonId,"approverAssignments")),rows=snap.docs.map(x=>({id:x.id,...x.data()})).filter(x=>x.scopeType==="season");$("#lineupApproverList").innerHTML=rows.map(x=>`<div class="structure-admin-row"><div><b>${esc(x.approverName||x.approverPlayerId||x.approverUid)}</b><small>${esc(x.approverPlayerId)} · ${esc(x.approverEmail||"")}</small></div><span class="badge ${x.status==="active"?"lime":"gray"}">${esc(x.status)}</span><button class="secondary compact-button" data-toggle-approver="${esc(x.id)}" data-next="${x.status==="active"?"inactive":"active"}">${x.status==="active"?"Deactivate":"Activate"}</button></div>`).join("")||'<div class="empty-state compact"><b>No season approvers assigned</b></div>';$$('[data-toggle-approver]').forEach(b=>b.addEventListener("click",()=>setApproverStatus(b.dataset.toggleApprover,b.dataset.next));}
async function assignApprover(){const seasonId=$("#lineupApproverSeason").value,uid=$("#lineupApproverPlayer").value,user=users.find(x=>x.uid===uid);if(!user)return;const ref=doc(db,"seasons",seasonId,"approverAssignments",uid),memberRef=doc(db,"seasons",seasonId,"members",uid);await runTransaction(db,async tx=>{const member=await tx.get(memberRef),roles=new Set(member.data()?.roles||["player"]);roles.add("neutralApprover");tx.set(ref,{approverUid:uid,approverPlayerId:user.playerId,approverName:user.displayName||user.email,approverEmail:user.email,scopeType:"season",status:"active",effectiveFrom:serverTimestamp(),effectiveTo:null,updatedByUid:auth.currentUser.uid,updatedAt:serverTimestamp()},{merge:true});tx.set(memberRef,{uid,playerId:user.playerId,status:"active",roles:[...roles],teamIds:member.data()?.teamIds||[],updatedAt:serverTimestamp()},{merge:true});});$("#lineupApproverMessage").textContent=`${user.displayName||user.email} assigned.`;await renderApprovers();}
async function setApproverStatus(id,status){const seasonId=$("#lineupApproverSeason").value,ref=doc(db,"seasons",seasonId,"approverAssignments",id),memberRef=doc(db,"seasons",seasonId,"members",id);await runTransaction(db,async tx=>{const member=await tx.get(memberRef),roles=new Set(member.data()?.roles||[]);status==="active"?roles.add("neutralApprover"):roles.delete("neutralApprover");tx.update(ref,{status,effectiveTo:status==="inactive"?serverTimestamp():null,updatedByUid:auth.currentUser.uid,updatedAt:serverTimestamp()});if(member.exists())tx.update(memberRef,{roles:[...roles],updatedAt:serverTimestamp()});});await renderApprovers();}

async function renderApprovalQueue(){const panel=$("#approvalRows");if(!panel||!data||!isApprover()){if(panel)panel.innerHTML='<div class="empty-state compact"><b>No active season approver assignment</b></div>';return;}const ready=[];for(const matchup of data.matchups){const [home,away]=await Promise.all([getDoc(doc(db,"seasons",data.seasonId,"matchups",matchup.matchupId,"lineups",matchup.homeTeamId)),getDoc(doc(db,"seasons",data.seasonId,"matchups",matchup.matchupId,"lineups",matchup.awayTeamId))]);if(home.data()?.status==="submitted"&&away.data()?.status==="submitted"&&home.data()?.submittedByUid!==auth.currentUser.uid&&away.data()?.submittedByUid!==auth.currentUser.uid&&!data.member?.teamIds?.some(id=>[matchup.homeTeamId,matchup.awayTeamId].includes(id)))ready.push({matchup,home:home.data(),away:away.data()});}panel.innerHTML=ready.map((r,i)=>`<label class="approval-pair"><input type="radio" name="approvalPair" value="${esc(r.matchup.matchupId)}" ${i===0?"checked":""}><b>${esc(r.matchup.weekId)} · ${esc(r.matchup.homeTeamNameSnapshot)} vs ${esc(r.matchup.awayTeamNameSnapshot)}</b>${[r.home,r.away].map(l=>`<div>${esc(data.teams.find(t=>t.teamId===l.teamId)?.name||l.teamId)}${l.lines.map(x=>`<small>Line ${x.lineNumber}: ${esc(x.player1Name)} / ${esc(x.player2Name)} · SOR ${x.sor}</small>`).join("")}</div>`).join("")}</label>`).join("")||'<div class="empty-state compact"><b>No neutral lineup pair ready</b><p>Both teams must submit, and you cannot approve your own team or a lineup you submitted.</p></div>';$("#approveLineups").disabled=!ready.length;}
async function approve(){const matchupId=document.querySelector('input[name="approvalPair"]:checked')?.value,matchup=data.matchups.find(x=>x.matchupId===matchupId);if(!matchup)return;const base=["seasons",data.seasonId,"matchups",matchupId],homeRef=doc(db,...base,"lineups",matchup.homeTeamId),awayRef=doc(db,...base,"lineups",matchup.awayTeamId),matchRef=doc(db,...base);await runTransaction(db,async tx=>{const [home,away]=await Promise.all([tx.get(homeRef),tx.get(awayRef)]);if(home.data()?.status!=="submitted"||away.data()?.status!=="submitted")throw new Error("Both lineups must remain submitted.");if([home.data()?.submittedByUid,away.data()?.submittedByUid].includes(auth.currentUser.uid))throw new Error("You cannot approve a lineup you submitted.");tx.update(homeRef,{status:"approved",approvedByUid:auth.currentUser.uid,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()});tx.update(awayRef,{status:"approved",approvedByUid:auth.currentUser.uid,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()});tx.update(matchRef,{bothLineupsSubmitted:true,lineupsPublished:true,status:"toBeScheduled",approvedByUid:auth.currentUser.uid,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()});for(let i=0;i<5;i++){const h=home.data().lines[i],a=away.data().lines[i],lineId=`${matchupId}-L${i+1}`;tx.set(doc(db,...base,"lineMatches",lineId),{lineMatchId:lineId,lineupId:lineId,seasonId:data.seasonId,matchupId,lineNumber:i+1,homeTeamId:matchup.homeTeamId,awayTeamId:matchup.awayTeamId,homePlayers:[{playerId:h.player1Id,nameSnapshot:h.player1Name,rankNumber:h.player1Rank},{playerId:h.player2Id,nameSnapshot:h.player2Name,rankNumber:h.player2Rank}],awayPlayers:[{playerId:a.player1Id,nameSnapshot:a.player1Name,rankNumber:a.player1Rank},{playerId:a.player2Id,nameSnapshot:a.player2Name,rankNumber:a.player2Rank}],homeSor:h.sor,awaySor:a.sor,scheduleStatus:"toBeScheduled",scoreStatus:"pending",homePoints:0,awayPoints:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});}});window.setTimeout(()=>location.reload(),400);}

$("#lineupWeek")?.addEventListener("change",()=>resolveLineupContext().catch(error=>setMessage(error.message)));$("#lineupTeam")?.addEventListener("change",()=>resolveLineupContext().catch(error=>setMessage(error.message)));$("#validateLineup")?.addEventListener("click",validate);$("#saveDraft")?.addEventListener("click",()=>save("draft").catch(e=>setMessage(e.message)));$("#submitLineup")?.addEventListener("click",()=>save("submitted").catch(e=>setMessage(e.message)));$("#approveLineups")?.addEventListener("click",()=>approve().catch(e=>window.alphaOpenAuthUI?.showMessage(e.message)));
function showLoadError(error){console.error("Lineup management load failed",error);const season=$("#lineupSeason"),week=$("#lineupWeek"),team=$("#lineupTeam");if(season)season.innerHTML='<option value="">Season load failed</option>';if(week)week.innerHTML='<option value="">Unavailable</option>';if(team)team.innerHTML='<option value="">Unavailable</option>';setMessage(`Unable to load active-season lineup data: ${error.message}`);}
onAuthStateChanged(auth,user=>{if(window.alphaOpenLocalDevelopment)return;if(!user){if($("#lineupRoleBadge"))$("#lineupRoleBadge").textContent="Sign in required";if($("#lineupSeason"))$("#lineupSeason").innerHTML='<option value="">Sign in required</option>';setMessage("Sign in as a Captain, Approver, EC, or Super Admin to load lineup data.");return;}load().catch(showLoadError);});
window.addEventListener("alphaopen:profile-ready",()=>{if(window.alphaOpenLocalDevelopment){const select=$("#lineupApproverSeason"),message=$("#lineupApproverMessage");if(select)select.innerHTML='<option value="">Live data unavailable in local development</option>';if(message)message.textContent="Open the deployed AlphaOpen site to manage live season approvers.";return;}load().catch(showLoadError);});

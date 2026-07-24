import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, doc, getDoc, getDocs, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { auth, db } from "./firebase-client.js?v=3";
import { loadCanonicalPlayers } from "./player-identity.js?v=1";

const byId=id=>document.getElementById(id);
let state=null;
const text=(node,value)=>{node.textContent=value;return node;};
const div=className=>{const node=document.createElement("div");node.className=className;return node;};
function setMessage(value){byId("approvalMessage").textContent=value;}
function teamName(id,snapshot){const team=state.teams.find(item=>item.teamId===id);return team&&team.name||snapshot||id;}

function lineupSide(teamId,teamLabel,lineup){
  const side=div("approval-team-side");
  const heading=document.createElement("h3");heading.textContent=teamLabel;side.appendChild(heading);
  if(!lineup){const blank=div("approval-lineup-missing");blank.innerHTML="<b>Lineup not submitted</b><span>This team has not yet submitted its lineup.</span>";side.appendChild(blank);return side;}
  for(let number=1;number<=5;number+=1){const line=(lineup.lines||[]).find(item=>Number(item.lineNumber)===number),row=div("approval-line-row");const label=text(document.createElement("b"),"L"+number);const players=text(document.createElement("span"),line?(line.player1Name||line.player1Id)+" / "+(line.player2Name||line.player2Id):"—");const sor=text(document.createElement("strong"),line?"SOR "+line.sor:"—");row.append(label,players,sor);side.appendChild(row);}
  return side;
}
function renderCard(record){
  const card=div("dashboard-card approval-matchup-card"),head=div("approval-matchup-head"),title=div("approval-matchup-title");
  title.innerHTML="<span>"+(record.matchup.weekId||record.matchup.stage||"Matchup")+"</span><h2>"+record.matchup.matchupId+"</h2><p>"+teamName(record.matchup.homeTeamId,record.matchup.homeTeamNameSnapshot)+" vs "+teamName(record.matchup.awayTeamId,record.matchup.awayTeamNameSnapshot)+"</p>";
  const stateBadge=text(document.createElement("span"),record.home&&record.away?"Ready for approval":"Waiting for both teams");stateBadge.className="badge "+(record.home&&record.away?"lime":"gray");head.append(title,stateBadge);
  const comparison=div("approval-lineup-comparison");comparison.append(lineupSide(record.matchup.homeTeamId,teamName(record.matchup.homeTeamId,record.matchup.homeTeamNameSnapshot),record.home),lineupSide(record.matchup.awayTeamId,teamName(record.matchup.awayTeamId,record.matchup.awayTeamNameSnapshot),record.away));
  const actions=div("approval-card-actions"),note=text(document.createElement("span"),record.reason||(!record.home||!record.away?"Approval becomes available after both teams submit.":"Both lineups are submitted and ready.")),button=text(document.createElement("button"),"Approve both lineups");button.className="primary";button.disabled=Boolean(record.reason)||!record.home||!record.away;button.addEventListener("click",()=>approve(record).catch(error=>setMessage("Approval failed: "+error.message)));
  const rejectionActions=div("approval-rejection-actions");
  [[record.matchup.homeTeamId,record.home],[record.matchup.awayTeamId,record.away]].forEach(([teamId,lineup])=>{
    if(!lineup)return;
    const reject=text(document.createElement("button"),"Reject "+teamName(teamId));reject.className="secondary";
    reject.addEventListener("click",()=>rejectLineup(record,teamId).catch(error=>setMessage("Rejection failed: "+error.message)));
    rejectionActions.appendChild(reject);
  });
  actions.append(note,button,rejectionActions);card.append(head,comparison,actions);return card;
}
async function load(user){
  setMessage("Reading active-season approvals from Firebase...");
  const control=await getDoc(doc(db,"systemConfig","seasonControl")),seasonId=control.data()&&control.data().activeSeasonId;if(!seasonId)throw new Error("No active season is configured.");
  const seasonRef=doc(db,"seasons",seasonId),results=await Promise.all([getDoc(seasonRef),getDoc(doc(seasonRef,"approverAssignments",user.uid)),getDoc(doc(seasonRef,"members",user.uid)),getDocs(collection(seasonRef,"teams")),getDocs(collection(seasonRef,"matchups"))]);
  const season=results[0],assignment=results[1],isSuperAdmin=user.email&&user.email.toLowerCase()==="sudarshandesai74@gmail.com";if(!season.exists())throw new Error("The active season record does not exist.");if(!isSuperAdmin&&(!assignment.exists()||assignment.data().status!=="active"||assignment.data().approverUid!==user.uid))throw new Error("You are not an active lineup approver for this season.");
  state={seasonId,season:season.data(),member:results[2].exists()?results[2].data():null,teams:results[3].docs.map(item=>({teamId:item.id,...item.data()})),matchups:results[4].docs.map(item=>({matchupId:item.id,...item.data()}))};
  byId("approvalSeason").replaceChildren(Object.assign(document.createElement("option"),{value:seasonId,textContent:state.season.name||seasonId}));byId("approvalRoleBadge").textContent=isSuperAdmin?"Super Admin":"Season Approver";
  const pending=[];
  for(const matchup of state.matchups){
    const homeSubmitted=matchup.homeLineupStatus==="submitted",awaySubmitted=matchup.awayLineupStatus==="submitted";
    if(!homeSubmitted&&!awaySubmitted)continue;
    const snapshots=await Promise.all([
      homeSubmitted?getDoc(doc(seasonRef,"matchups",matchup.matchupId,"lineups",matchup.homeTeamId)):Promise.resolve(null),
      awaySubmitted?getDoc(doc(seasonRef,"matchups",matchup.matchupId,"lineups",matchup.awayTeamId)):Promise.resolve(null)
    ]);
    const home=snapshots[0]?.exists()&&snapshots[0].data().status==="submitted"?snapshots[0].data():null,away=snapshots[1]?.exists()&&snapshots[1].data().status==="submitted"?snapshots[1].data():null;
    pending.push({matchup,home,away,reason:""});
  }
  pending.sort((a,b)=>String(a.matchup.weekId).localeCompare(String(b.matchup.weekId))||a.matchup.matchupId.localeCompare(b.matchup.matchupId));const queue=byId("approvalQueue");queue.replaceChildren();if(!pending.length){const empty=div("dashboard-card empty-state");empty.innerHTML="<b>No lineups pending approval</b><p>Submitted lineups will appear here automatically.</p>";queue.appendChild(empty);}else pending.forEach(record=>queue.appendChild(renderCard(record)));setMessage(pending.length+" matchup"+(pending.length===1?"":"s")+" pending review in "+(state.season.name||seasonId)+".");
}
async function approve(record){
  const user=auth.currentUser,matchup=record.matchup,base=["seasons",state.seasonId,"matchups",matchup.matchupId],homeRef=doc(db,...base,"lineups",matchup.homeTeamId),awayRef=doc(db,...base,"lineups",matchup.awayTeamId),matchRef=doc(db,...base);
  const canonicalPlayers=await loadCanonicalPlayers();
  await runTransaction(db,async transaction=>{const snapshots=await Promise.all([transaction.get(homeRef),transaction.get(awayRef)]),home=snapshots[0].data(),away=snapshots[1].data();if(home&&home.status!=="submitted"||away&&away.status!=="submitted"||!home||!away)throw new Error("Both lineups must still be submitted.");const ids=[...home.lines,...away.lines].flatMap(line=>[line.player1Id,line.player2Id]);const missing=[...new Set(ids.filter(id=>!canonicalPlayers.has(id)))];if(missing.length)throw new Error("Approval stopped. Unknown Player ID: "+missing.join(", ")+".");transaction.update(homeRef,{status:"approved",approvedByUid:user.uid,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()});transaction.update(awayRef,{status:"approved",approvedByUid:user.uid,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()});transaction.update(matchRef,{homeLineupStatus:"approved",awayLineupStatus:"approved",bothLineupsSubmitted:true,lineupsPublished:true,status:"inProgress",approvedByUid:user.uid,approvedAt:serverTimestamp(),updatedAt:serverTimestamp()});for(let index=0;index<5;index+=1){const h=home.lines[index],a=away.lines[index],lineId=matchup.matchupId+"-L"+(index+1);transaction.set(doc(db,...base,"lineMatches",lineId),{lineMatchId:lineId,lineupId:lineId,seasonId:state.seasonId,matchupId:matchup.matchupId,lineNumber:index+1,homeTeamId:matchup.homeTeamId,awayTeamId:matchup.awayTeamId,homePlayers:[{playerId:h.player1Id,nameSnapshot:canonicalPlayers.get(h.player1Id).displayName,rankNumber:h.player1Rank},{playerId:h.player2Id,nameSnapshot:canonicalPlayers.get(h.player2Id).displayName,rankNumber:h.player2Rank}],awayPlayers:[{playerId:a.player1Id,nameSnapshot:canonicalPlayers.get(a.player1Id).displayName,rankNumber:a.player1Rank},{playerId:a.player2Id,nameSnapshot:canonicalPlayers.get(a.player2Id).displayName,rankNumber:a.player2Rank}],homeSor:h.sor,awaySor:a.sor,scheduleStatus:"toBeScheduled",scoreStatus:"pending",homePoints:0,awayPoints:0,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});}});setMessage("Lineups approved for "+matchup.matchupId+". Refreshing queue...");await load(user);
}
async function rejectLineup(record,teamId){
  const reason=window.prompt("Reason for rejecting "+teamName(teamId)+"'s lineup:");
  if(reason===null)return;
  if(!reason.trim())throw new Error("Enter a rejection reason so the submitter knows what to correct.");
  const user=auth.currentUser,matchup=record.matchup,base=["seasons",state.seasonId,"matchups",matchup.matchupId],lineupRef=doc(db,...base,"lineups",teamId),matchRef=doc(db,...base);
  const statusField=matchup.homeTeamId===teamId?"homeLineupStatus":"awayLineupStatus";
  await runTransaction(db,async transaction=>{
    const snapshot=await transaction.get(lineupRef);
    if(!snapshot.exists()||snapshot.data().status!=="submitted")throw new Error("This lineup is no longer awaiting review.");
    transaction.update(lineupRef,{status:"rejected",rejectionReason:reason.trim(),rejectedByUid:user.uid,rejectedAt:serverTimestamp(),updatedByUid:user.uid,updatedAt:serverTimestamp()});
    transaction.update(matchRef,{[statusField]:"rejected",bothLineupsSubmitted:false,lineupsPublished:false,updatedAt:serverTimestamp()});
  });
  setMessage(teamName(teamId)+" lineup rejected. The submitter can correct and resubmit it.");
  await load(user);
}
onAuthStateChanged(auth,user=>{if(!user){byId("approvalRoleBadge").textContent="Sign in required";setMessage("Sign in as an active season lineup approver.");return;}load(user).catch(error=>{byId("approvalRoleBadge").textContent="Access unavailable";setMessage(error.message);const queue=byId("approvalQueue");queue.innerHTML='<div class="dashboard-card empty-state"><b>Approval queue unavailable</b><p>'+error.message+'</p></div>';});});

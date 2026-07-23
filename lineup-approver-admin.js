import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import { collection, deleteDoc, doc, getDocs, getFirestore, runTransaction, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

const config={projectId:"alphaopen-development-2026",appId:"1:128657830722:web:07c8c84d0386b5b11c4edb",storageBucket:"alphaopen-development-2026.firebasestorage.app",apiKey:"AIzaSyCBxY1bOkhALp1W_1yXFmDo9jdFhRNQqIY",authDomain:"alphaopen-development-2026.firebaseapp.com",messagingSenderId:"128657830722"};
const app=getApps().length?getApp():initializeApp(config),auth=getAuth(app),db=getFirestore(app);
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??"").replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
let players=[];
let removedLegacyAssignments=0;
const INVALID_LEGACY_UIDS=new Set(["87ofw03npOZEUu49WDeyBhcsDnr2","GKJFTHdJP7NSVnE63im82ESVoXo2","iCapunpPSRhcCiaZ6hzsihVsdRg1"]);

function message(text){const node=$("#lineupApproverMessage");if(node)node.textContent=text;}

async function renderApprovers(){
  const seasonId=$("#lineupApproverSeason")?.value,list=$("#lineupApproverList");
  if(!seasonId||!list)return;
  const snapshot=await getDocs(collection(db,"seasons",seasonId,"approverAssignments"));
  const allRows=snapshot.docs.map(item=>({id:item.id,...item.data()})).filter(item=>item.scopeType==="season");
  const invalid=allRows.filter(item=>item.status==="inactive"&&INVALID_LEGACY_UIDS.has(item.approverUid)&&!item.approverPlayerId&&!item.approverName&&!item.approverEmail);
  if(invalid.length){await Promise.all(invalid.map(item=>deleteDoc(doc(db,"seasons",seasonId,"approverAssignments",item.id))));removedLegacyAssignments+=invalid.length;}
  const invalidIds=new Set(invalid.map(item=>item.id)),rows=allRows.filter(item=>!invalidIds.has(item.id));
  list.innerHTML=rows.map(item=>`<div class="structure-admin-row"><div><b>${esc(item.approverName||item.approverPlayerId||item.approverUid)}</b><small>${esc(item.approverPlayerId)} · ${esc(item.approverEmail||"")}</small></div><span class="badge ${item.status==="active"?"lime":"gray"}">${esc(item.status)}</span><div class="approver-admin-actions"><button class="secondary compact-button" data-direct-approver="${esc(item.id)}" data-next="${item.status==="active"?"inactive":"active"}">${item.status==="active"?"Deactivate":"Activate"}</button><button class="danger compact-button" data-delete-approver="${esc(item.id)}" data-approver-name="${esc(item.approverName||item.approverPlayerId||item.approverUid)}">Delete</button></div></div>`).join("")||'<div class="empty-state compact"><b>No season approvers assigned</b></div>';
  list.querySelectorAll("[data-direct-approver]").forEach(button=>button.addEventListener("click",()=>setStatus(button.dataset.directApprover,button.dataset.next).catch(error=>message(`Approver update failed: ${error.message}`))));
  list.querySelectorAll("[data-delete-approver]").forEach(button=>button.addEventListener("click",()=>deleteAssignment(button.dataset.deleteApprover,button.dataset.approverName).catch(error=>message(`Approver deletion failed: ${error.message}`))));
}

async function load(){
  const seasonSelect=$("#lineupApproverSeason"),playerSelect=$("#lineupApproverPlayer");
  if(!seasonSelect||!playerSelect)return;
  seasonSelect.innerHTML='<option value="">Loading Firebase seasons…</option>';
  message("Connected. Reading seasons from Firebase…");
  try{
    const seasons=await getDocs(collection(db,"seasons"));
    const rows=seasons.docs.map(item=>({id:item.id,...item.data()})).sort((a,b)=>Number(b.year||0)-Number(a.year||0));
    seasonSelect.innerHTML=rows.map(item=>`<option value="${esc(item.id)}">${esc(item.name||item.id)}</option>`).join("")||'<option value="">No Firebase seasons found</option>';
    if(!rows.length){message("Firebase returned zero season records.");return;}
    message(`${rows.length} seasons loaded. Reading registered players…`);
    await renderApprovers();
    const [users,playerMaster]=await Promise.all([getDocs(collection(db,"users")),getDocs(collection(db,"players"))]);
    const playerNames=new Map(playerMaster.docs.map(item=>[item.id,item.data().displayName||item.data().fullName||item.id]));
    players=users.docs.map(item=>{
      const user={uid:item.id,...item.data()};
      return {...user,playerName:playerNames.get(user.playerId)||user.displayName||user.email};
    }).filter(item=>item.status==="active"&&item.playerId).sort((a,b)=>String(a.playerName).localeCompare(String(b.playerName)));
    playerSelect.innerHTML='<option value="">Select a registered player</option>'+players.map(item=>`<option value="${esc(item.uid)}">${esc(item.playerName)} · ${esc(item.playerId)}</option>`).join("");
    message(`${rows.length} seasons · ${players.length} registered players available.${removedLegacyAssignments?` Removed ${removedLegacyAssignments} invalid legacy approver records.`:""}`);
  }catch(error){
    seasonSelect.innerHTML='<option value="">Firebase load failed</option>';
    message(`Firebase load failed (${error.code||"error"}): ${error.message}`);
    console.error("Direct lineup approver load failed",error);
  }
}

async function assign(){
  const seasonId=$("#lineupApproverSeason")?.value,uid=$("#lineupApproverPlayer")?.value,player=players.find(item=>item.uid===uid);
  if(!seasonId||!player){message("Select a season and registered player.");return;}
  const assignmentRef=doc(db,"seasons",seasonId,"approverAssignments",uid),memberRef=doc(db,"seasons",seasonId,"members",uid);
  await runTransaction(db,async transaction=>{
    const member=await transaction.get(memberRef),roles=new Set(member.data()?.roles||["player"]);roles.add("neutralApprover");
    transaction.set(assignmentRef,{approverUid:uid,approverPlayerId:player.playerId,approverName:player.playerName,approverEmail:player.email,scopeType:"season",status:"active",effectiveFrom:serverTimestamp(),effectiveTo:null,updatedByUid:auth.currentUser.uid,updatedAt:serverTimestamp()},{merge:true});
    transaction.set(memberRef,{uid,playerId:player.playerId,status:"active",roles:[...roles],teamIds:member.data()?.teamIds||[],updatedAt:serverTimestamp()},{merge:true});
  });
  message(`${player.playerName} assigned as a season approver.`);await renderApprovers();
}

async function setStatus(uid,status){
  const seasonId=$("#lineupApproverSeason")?.value,assignmentRef=doc(db,"seasons",seasonId,"approverAssignments",uid),memberRef=doc(db,"seasons",seasonId,"members",uid);
  await runTransaction(db,async transaction=>{const member=await transaction.get(memberRef),roles=new Set(member.data()?.roles||[]);status==="active"?roles.add("neutralApprover"):roles.delete("neutralApprover");transaction.update(assignmentRef,{status,effectiveTo:status==="inactive"?serverTimestamp():null,updatedByUid:auth.currentUser.uid,updatedAt:serverTimestamp()});if(member.exists())transaction.update(memberRef,{roles:[...roles],updatedAt:serverTimestamp()});});
  await renderApprovers();
}

async function deleteAssignment(uid,name){
  const seasonId=$("#lineupApproverSeason")?.value;
  if(!seasonId||!window.confirm(`Delete ${name} as an approver for this season? The player account will not be deleted.`))return;
  const assignmentRef=doc(db,"seasons",seasonId,"approverAssignments",uid),memberRef=doc(db,"seasons",seasonId,"members",uid);
  await runTransaction(db,async transaction=>{
    const member=await transaction.get(memberRef),roles=new Set(member.data()?.roles||[]);roles.delete("neutralApprover");
    transaction.delete(assignmentRef);
    if(member.exists())transaction.update(memberRef,{roles:[...roles],updatedAt:serverTimestamp()});
  });
  message(`${name} was removed as an approver for this season.`);await renderApprovers();
}

function ownControls(){
  for(const id of ["lineupApproverSeason","refreshLineupApprovers","assignLineupApprover"]){const old=document.getElementById(id);if(!old)continue;const fresh=old.cloneNode(true);old.replaceWith(fresh);}
  $("#lineupApproverSeason")?.addEventListener("change",()=>renderApprovers().catch(error=>message(`Approver list failed: ${error.message}`)));
  $("#refreshLineupApprovers")?.addEventListener("click",()=>load());
  $("#assignLineupApprover")?.addEventListener("click",()=>assign().catch(error=>message(`Approver assignment failed: ${error.message}`)));
}

ownControls();
const localDevelopment=["localhost","127.0.0.1","::1"].includes(location.hostname);
message(localDevelopment?"Firebase disabled in local development.":"Waiting for the authenticated Firebase session…");
if(!localDevelopment)onAuthStateChanged(auth,user=>{
  if(!user){const select=$("#lineupApproverSeason");if(select)select.innerHTML='<option value="">Sign in required</option>';message("Sign in as Super Admin to load seasons.");return;}
  if(user.email?.toLowerCase()!=="sudarshandesai74@gmail.com"){message("Only the protected Super Admin can manage season approvers.");return;}
  load();
});

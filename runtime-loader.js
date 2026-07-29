const LOCAL_HOSTS=new Set(["localhost","127.0.0.1","::1"]),isLocalDevelopment=LOCAL_HOSTS.has(location.hostname),useFirebaseEmulator=isLocalDevelopment&&new URLSearchParams(location.search).get("firebase")==="emulator";
const coreModules=["./firebase-auth.js?v=44","./firebase-data.js?v=88"];
const loadedFeatureModules=new Map();
const importFeature=path=>{if(!loadedFeatureModules.has(path))loadedFeatureModules.set(path,import(path));return loadedFeatureModules.get(path);};
const adminModuleForPanel={players:"./player-admin.js?v=45",users:"./operations-access-admin.js?v=1","identity-audit":"./identity-reconciliation.js?v=12",rosters:"./roster-admin-v3.js?v=21",venues:"./venue-admin.js?v=28",seasons:"./season-bulk-import.js?v=20","season-teams":"./season-structure-admin.js?v=12","season-matchups":"./season-structure-admin.js?v=12","lineup-approvers":"./lineup-approver-admin.js?v=5"};
function loadRouteFeature(route){
  if(["current-season","captain-schedule","captain-score"].includes(route))return importFeature("./season-operations.js?v=2");
  if(route==="ec-roster")return importFeature("./roster-admin-v3.js?v=21");
  if(route==="ec-lineup")return importFeature("./lineup-update.js?v=15");
  if(route==="admin")return importFeature(adminModuleForPanel[document.querySelector("[data-admin-panel].active")?.dataset.adminPanel]||adminModuleForPanel.players);
  return Promise.resolve();
}

if(!isLocalDevelopment||useFirebaseEmulator){
  await import("./firebase-client.js?v=5");
  const results=await Promise.allSettled(coreModules.map(path=>import(path)));
  results.forEach((result,index)=>{if(result.status==="rejected")console.error(`AlphaOpen module failed: ${coreModules[index]}`,result.reason);});
  const currentRoute=()=>location.hash.slice(1)||"home";
  window.addEventListener("alphaopen:route-changed",event=>loadRouteFeature(event.detail?.route||currentRoute()).catch(error=>console.error("AlphaOpen route module failed",error)));
  window.addEventListener("alphaopen:admin-panel-changed",event=>{const path=adminModuleForPanel[event.detail?.panel];if(path)importFeature(path).catch(error=>console.error("AlphaOpen Admin module failed",error));});
  loadRouteFeature(currentRoute()).catch(error=>console.error("AlphaOpen initial route module failed",error));
  if(useFirebaseEmulator){
    window.alphaOpenLocalDevelopment=true;
    document.body.classList.add("local-development");
    const prototypeBar=document.querySelector(".prototype-bar>span");
    if(prototypeBar)prototypeBar.innerHTML='<b>AlphaOpen</b><span class="desktop-only"> · Local data emulator</span>';
  }
}else{
  window.alphaOpenLocalDevelopment=true;
  document.body.classList.add("local-development");
  window.alphaOpenProfileReady=null;
  window.alphaOpenAuthUI?.applyGuest();
  const authStatus=document.querySelector("#authStatus"),prototypeBar=document.querySelector(".prototype-bar>span");
  if(authStatus)authStatus.textContent="Local development · Guest";
  if(prototypeBar)prototypeBar.innerHTML="<b>AlphaOpen</b><span class=\"desktop-only\"> · Local development · Live data disabled</span>";
  window.alphaOpenDataUI?.showError("Local development mode is active. Live data reads and writes are disabled.");
  window.alphaOpenDataUI?.showHistoryError("Local development mode is active. Live data reads and writes are disabled.");
  window.dispatchEvent(new CustomEvent("alphaopen:profile-ready",{detail:window.alphaOpenProfileReady}));

  let firebaseAuthEnabled=false;
  window.addEventListener("alphaopen:request-signout",()=>{
    window.alphaOpenAuthUI?.applyGuest(true);
    if(authStatus)authStatus.textContent="Local development · Signed out";
  });
  window.addEventListener("alphaopen:request-signin",async()=>{
    if(firebaseAuthEnabled)return;
    firebaseAuthEnabled=true;
    await import("./firebase-auth.js?v=44");
    window.dispatchEvent(new CustomEvent("alphaopen:request-signin"));
  });
}

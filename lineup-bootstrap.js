(()=>{
  let started=false;
  const start=()=>{if(started)return;started=true;
  const badge=document.querySelector("#lineupRoleBadge"),message=document.querySelector("#lineupStateMessage"),season=document.querySelector("#lineupSeason");
  if(badge)badge.textContent="Starting";
  if(message)message.textContent="Starting the lineup service...";
  const fail=error=>{
    console.error("Submit Lineup startup failed",error);
    if(badge)badge.textContent="Load failed";
    if(season)season.innerHTML='<option value="">Lineup service unavailable</option>';
    if(message)message.textContent=`Submit Lineup startup failed: ${error?.message||error}`;
  };
  window.addEventListener("unhandledrejection",event=>{if(String(event.reason?.stack||event.reason||"").includes("lineup"))fail(event.reason);});
  import("./lineup-submit.js?v=21").catch(fail);
  };
  window.addEventListener("alphaopen:route-changed",event=>{if(event.detail?.route==="lineup")start();});
  if((location.hash.slice(1)||"home")==="lineup")start();
})();

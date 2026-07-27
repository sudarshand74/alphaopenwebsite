(()=>{
  let started=false;
  const start=()=>{
    if(started)return;
    started=true;
    import("./ec-lineup-status.js?v=2").catch(error=>{
      console.error("EC matchup status dashboard failed to start",error);
      const message=document.getElementById("ecStatusMessage");
      const dashboard=document.getElementById("ecStatusDashboard");
      if(message)message.textContent="The Lineup Dashboard could not be loaded.";
      if(dashboard)dashboard.innerHTML='<div class="empty-state"><b>Dashboard unavailable</b><p>Please refresh and try again.</p></div>';
    });
  };
  window.addEventListener("alphaopen:route-changed",event=>{
    if(event.detail?.route==="ec-lineup-status")start();
  });
  if((location.hash.slice(1)||"home")==="ec-lineup-status")start();
})();

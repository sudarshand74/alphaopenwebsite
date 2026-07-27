(()=>{
  let started=false;
  const start=()=>{
    if(started)return;
    started=true;
    const message=document.querySelector("#lineupResetMessage");
    if(message)message.textContent="Starting the approved-lineup reset service...";
    import("./lineup-reset.js?v=3").catch(error=>{
      console.error("Reset Approved Lineup startup failed",error);
      if(message)message.textContent="Reset Approved Lineup failed to start: "+(error?.message||error);
    });
  };
  window.addEventListener("alphaopen:route-changed",event=>{
    if(event.detail?.route==="reset-approved-lineup")start();
  });
  if((location.hash.slice(1)||"home")==="reset-approved-lineup")start();
})();

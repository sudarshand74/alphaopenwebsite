const LOCAL_HOSTS=new Set(["localhost","127.0.0.1","::1"]),isLocalDevelopment=LOCAL_HOSTS.has(location.hostname);
const liveModules=["./firebase-auth.js?v=28","./firebase-data.js?v=33","./player-admin.js?v=27","./venue-admin.js?v=26","./season-operations.js?v=1","./roster-admin-v3.js?v=4"];

if(!isLocalDevelopment){
  await Promise.all(liveModules.map(path=>import(path)));
}else{
  window.alphaOpenLocalDevelopment=true;
  document.body.classList.add("local-development");
  const user={uid:"LOCAL-DEV-SUPER-ADMIN",displayName:"Sudarshan Desai",email:"sudarshandesai74@gmail.com",emailVerified:true};
  const authorization={role:"Super Admin",access:["player","captain","approver","ec"],playerId:"P1201",status:"active"};
  window.alphaOpenProfileReady={uid:user.uid,status:"ready",localDevelopment:true};
  window.alphaOpenAuthUI?.applyUser(user,authorization,false);
  const authStatus=document.querySelector("#authStatus"),prototypeBar=document.querySelector(".prototype-bar>span");
  if(authStatus)authStatus.textContent="Local Super Admin";
  if(prototypeBar)prototypeBar.innerHTML="<b>AlphaOpen</b><span class=\"desktop-only\"> · Local development · Firebase disabled</span>";
  window.alphaOpenDataUI?.showError("Local development mode is active. Firebase reads and writes are disabled.");
  window.alphaOpenDataUI?.showHistoryError("Local development mode is active. Firebase reads and writes are disabled.");
  window.dispatchEvent(new CustomEvent("alphaopen:profile-ready",{detail:window.alphaOpenProfileReady}));

  let firebaseAuthEnabled=false;
  window.addEventListener("alphaopen:request-signout",()=>{
    window.alphaOpenAuthUI?.applyGuest(true);
    if(authStatus)authStatus.textContent="Local development · Signed out";
  });
  window.addEventListener("alphaopen:request-signin",async()=>{
    if(firebaseAuthEnabled)return;
    firebaseAuthEnabled=true;
    await import("./firebase-auth.js?v=28");
    window.dispatchEvent(new CustomEvent("alphaopen:request-signin"));
  });
}

(() => {
  const installPrompt = document.querySelector("#installPrompt");
  const installButton = document.querySelector("#installButton");
  const dismissInstall = document.querySelector("#dismissInstall");
  const networkStatus = document.querySelector("#networkStatus");
  let deferredInstall;

  const updateNetworkStatus = () => {
    networkStatus.hidden = navigator.onLine;
    document.body.classList.toggle("is-offline", !navigator.onLine);
  };

  window.addEventListener("online", updateNetworkStatus);
  window.addEventListener("offline", updateNetworkStatus);
  updateNetworkStatus();

  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstall = event;
    if (localStorage.getItem("alphaopen.installDismissed") !== "true") installPrompt.hidden = false;
  });

  installButton.addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    installPrompt.hidden = true;
  });

  dismissInstall.addEventListener("click", () => {
    installPrompt.hidden = true;
    localStorage.setItem("alphaopen.installDismissed", "true");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    installPrompt.hidden = true;
  });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js"));
  }
})();

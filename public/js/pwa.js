(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function (error) {
        console.warn("No se pudo registrar el service worker:", error);
      });
    });
  }

  let deferredPrompt = null;
  let installButton = null;

  function createInstallButton() {
    if (installButton || window.matchMedia("(display-mode: standalone)").matches) return;

    installButton = document.createElement("button");
    installButton.type = "button";
    installButton.textContent = "Instalar app";
    installButton.setAttribute("aria-label", "Instalar aplicación Tomza");
    installButton.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "border:0",
      "border-radius:999px",
      "background:#111827",
      "color:#fff",
      "font-weight:700",
      "padding:10px 14px",
      "box-shadow:0 12px 28px rgba(15,23,42,.28)",
      "font-family:Segoe UI,Arial,sans-serif"
    ].join(";");

    installButton.addEventListener("click", async function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      installButton.remove();
      installButton = null;
    });

    document.body.appendChild(installButton);
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredPrompt = event;
    createInstallButton();
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    if (installButton) installButton.remove();
    installButton = null;
  });
})();

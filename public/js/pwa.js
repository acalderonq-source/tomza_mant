(function () {
  let swRegistrationPromise = null;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      swRegistrationPromise = navigator.serviceWorker.register("/sw.js").catch(function (error) {
        console.warn("No se pudo registrar el service worker:", error);
        return null;
      });
    });
  }

  let deferredPrompt = null;
  let installButton = null;
  let notificationButton = null;

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }

    return outputArray;
  }

  async function getServiceWorkerRegistration() {
    if (!("serviceWorker" in navigator)) return null;
    if (!swRegistrationPromise) {
      swRegistrationPromise = navigator.serviceWorker.register("/sw.js").catch(function (error) {
        console.warn("No se pudo registrar el service worker:", error);
        return null;
      });
    }
    return swRegistrationPromise;
  }

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

  function removeNotificationButton() {
    if (notificationButton) {
      notificationButton.remove();
      notificationButton = null;
    }
  }

  async function subscribeNotifications(options = {}) {
    const silent = Boolean(options.silent);

    if (!("Notification" in window) || !("PushManager" in window)) {
      if (!silent) alert("Este navegador no soporta notificaciones push.");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      if (!silent) alert("Debe permitir las notificaciones para recibir recordatorios.");
      return;
    }

    const registration = await getServiceWorkerRegistration();
    if (!registration) {
      if (!silent) alert("No se pudo preparar la app para notificaciones.");
      return;
    }

    const keyResponse = await fetch("/notificaciones/public-key");
    if (!keyResponse.ok) {
      if (!silent) alert("Las notificaciones no están configuradas en el servidor.");
      return;
    }
    const keyData = await keyResponse.json();
    const applicationServerKey = urlBase64ToUint8Array(keyData.publicKey);

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey
      });
    }

    const saveResponse = await fetch("/notificaciones/suscribir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription })
    });

    if (!saveResponse.ok) {
      if (!silent) alert("No se pudo guardar la suscripción de notificaciones.");
      return;
    }

    removeNotificationButton();
    if (!silent) alert("Notificaciones activadas. Recibirá avisos de mantenimientos pendientes un día antes.");
  }

  function createNotificationButton() {
    if (notificationButton || !("Notification" in window) || !("PushManager" in window)) return;
    if (Notification.permission === "granted") return;

    notificationButton = document.createElement("button");
    notificationButton.type = "button";
    notificationButton.textContent = "Activar notificaciones";
    notificationButton.setAttribute("aria-label", "Activar notificaciones de mantenimientos");
    notificationButton.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:64px",
      "z-index:2147483647",
      "border:0",
      "border-radius:999px",
      "background:#dc2626",
      "color:#fff",
      "font-weight:700",
      "padding:10px 14px",
      "box-shadow:0 12px 28px rgba(15,23,42,.28)",
      "font-family:Segoe UI,Arial,sans-serif"
    ].join(";");

    notificationButton.addEventListener("click", function () {
      subscribeNotifications().catch(function (error) {
        console.warn("No se pudo activar notificaciones:", error);
        alert("No se pudo activar notificaciones.");
      });
    });

    document.body.appendChild(notificationButton);
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

  window.addEventListener("load", function () {
    if ("Notification" in window && Notification.permission === "granted") {
      subscribeNotifications({ silent: true }).catch(function (error) {
        console.warn("No se pudo renovar la suscripción de notificaciones:", error);
      });
    } else {
      createNotificationButton();
    }
  });
})();

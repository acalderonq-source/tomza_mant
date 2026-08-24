(function () {
  if (window.__tomzaLoadingGuard) return;
  window.__tomzaLoadingGuard = true;

  const OVERLAY_ID = "tomza-loading-overlay";
  const STYLE_ID = "tomza-loading-style";
  const DEFAULT_MESSAGE = "Guardando, por favor espere...";

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        align-items: center;
        background: rgba(15, 23, 42, .52);
        backdrop-filter: blur(2px);
        bottom: 0;
        display: none;
        justify-content: center;
        left: 0;
        position: fixed;
        right: 0;
        top: 0;
        z-index: 2147483646;
      }

      #${OVERLAY_ID}.is-visible {
        display: flex;
      }

      .tomza-loading-card {
        align-items: center;
        background: #ffffff;
        border: 1px solid rgba(148, 163, 184, .35);
        border-radius: 16px;
        box-shadow: 0 24px 70px rgba(15, 23, 42, .32);
        color: #0f172a;
        display: flex;
        flex-direction: column;
        font-family: "Segoe UI", Arial, sans-serif;
        gap: .85rem;
        min-width: min(86vw, 320px);
        padding: 1.5rem 1.75rem;
        text-align: center;
      }

      .tomza-loading-spinner {
        animation: tomzaLoadingSpin .75s linear infinite;
        border: 5px solid #dbeafe;
        border-top-color: #e2232a;
        border-radius: 999px;
        height: 56px;
        width: 56px;
      }

      .tomza-loading-title {
        font-size: 1rem;
        font-weight: 900;
      }

      .tomza-loading-subtitle {
        color: #64748b;
        font-size: .82rem;
        font-weight: 700;
      }

      @keyframes tomzaLoadingSpin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlay() {
    injectStyle();

    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-busy", "true");
    overlay.innerHTML = `
      <div class="tomza-loading-card" role="status">
        <div class="tomza-loading-spinner" aria-hidden="true"></div>
        <div>
          <div class="tomza-loading-title">${DEFAULT_MESSAGE}</div>
          <div class="tomza-loading-subtitle">No presione de nuevo.</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function showLoading(message) {
    const overlay = ensureOverlay();
    const title = overlay.querySelector(".tomza-loading-title");
    if (title) title.textContent = message || DEFAULT_MESSAGE;
    overlay.classList.add("is-visible");
    document.documentElement.classList.add("tomza-loading-active");
  }

  function hideLoading() {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) overlay.classList.remove("is-visible");
    document.documentElement.classList.remove("tomza-loading-active");
  }

  function isDownloadForm(form, submitter) {
    const action = String(submitter?.formAction || form.getAttribute("action") || "").toLowerCase();
    const method = String(submitter?.formMethod || form.getAttribute("method") || "GET").toUpperCase();
    if (form.hasAttribute("data-no-loading")) return true;
    if (form.target && form.target !== "_self") return true;
    if (method === "GET" && /\.(pdf|xlsx?|csv)(?:$|[?#])/.test(action)) return true;
    if (method === "GET" && /descargar|download|exportar|excel|pdf/.test(action)) return true;
    return false;
  }

  function loadingMessage(form) {
    return form.getAttribute("data-loading-text") ||
      form.querySelector("[data-loading-text]")?.getAttribute("data-loading-text") ||
      DEFAULT_MESSAGE;
  }

  function disableSubmitButtons(form) {
    window.setTimeout(function () {
      form.querySelectorAll("button[type='submit'], button:not([type]), input[type='submit']").forEach(function (button) {
        if (button.disabled) return;
        button.dataset.tomzaOriginalText = button.dataset.tomzaOriginalText || button.textContent || button.value || "";
        button.dataset.tomzaLoadingDisabled = "true";
        button.disabled = true;
      });
    }, 0);
  }

  document.addEventListener("submit", function (event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (event.defaultPrevented) return;
    if (isDownloadForm(form, event.submitter)) return;

    const method = String(event.submitter?.formMethod || form.getAttribute("method") || "GET").toUpperCase();
    if (method !== "POST" && !form.hasAttribute("data-loading")) return;

    if (form.dataset.tomzaSubmitting === "true") {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    form.dataset.tomzaSubmitting = "true";
    showLoading(loadingMessage(form));
    disableSubmitButtons(form);
  }, false);

  window.addEventListener("pageshow", function () {
    hideLoading();
    document.querySelectorAll("form[data-tomza-submitting='true']").forEach(function (form) {
      delete form.dataset.tomzaSubmitting;
      form.querySelectorAll("[data-tomza-loading-disabled='true']").forEach(function (button) {
        delete button.dataset.tomzaLoadingDisabled;
        button.disabled = false;
      });
    });
  });

  window.TomzaLoading = {
    show: showLoading,
    hide: hideLoading
  };
})();

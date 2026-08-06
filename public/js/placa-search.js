(function () {
  const STYLE_ID = "tomza-plate-search-style";
  const DEFAULT_URL = "/api/unidades/buscar";
  const cache = new Map();
  const pending = new Map();

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .tomza-plate-search { position: relative; }
      .tomza-plate-results {
        background: #fff;
        border: 1px solid #dbe3ef;
        border-radius: 10px;
        box-shadow: 0 14px 32px rgba(15, 23, 42, .16);
        display: none;
        left: 0;
        max-height: 230px;
        overflow-y: auto;
        position: absolute;
        right: 0;
        top: calc(100% + 4px);
        z-index: 2000;
      }
      .tomza-plate-results.is-open { display: block; }
      .tomza-plate-option {
        align-items: center;
        background: transparent;
        border: 0;
        border-bottom: 1px solid #eef2f7;
        display: flex;
        gap: .75rem;
        justify-content: space-between;
        padding: .55rem .7rem;
        text-align: left;
        width: 100%;
      }
      .tomza-plate-option:hover,
      .tomza-plate-option:focus { background: #eef2ff; outline: 0; }
      .tomza-plate-option strong { color: #111827; font-size: .92rem; white-space: nowrap; }
      .tomza-plate-option span { color: #64748b; font-size: .78rem; text-align: right; }
      .tomza-plate-selected {
        color: #166534;
        font-size: .82rem;
        font-weight: 800;
        margin-top: .35rem;
        min-height: 1.2rem;
      }
      .tomza-plate-empty {
        color: #64748b;
        font-size: .82rem;
        padding: .6rem .7rem;
      }
    `;
    document.head.appendChild(style);
  }

  function cleanPlate(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  function normalizePlate(value) {
    const raw = cleanPlate(value);
    if (!raw) return "";

    if (/^CLC\d{5,6}$/.test(raw)) return raw.replace(/^CLC/, "CL");
    if (/^CL\d{5,6}$/.test(raw)) return raw;
    if (/^SS\d{5,6}$/.test(raw)) return raw.replace(/^SS/, "S");
    if (/^S\d{5,6}$/.test(raw)) return raw;
    if (/^C\d{5,6}$/.test(raw)) return raw;
    if (/^\d{5,6}$/.test(raw)) return /^[23]/.test(raw) ? `CL${raw}` : `C${raw}`;
    const embedded = raw.match(/(?:CL|C|S)?\d{5,6}/);
    if (embedded) return normalizePlate(embedded[0]);
    return raw;
  }

  function plateVariants(value) {
    const raw = cleanPlate(value);
    const normalized = normalizePlate(value);
    const values = new Set([raw, normalized].filter(Boolean));
    const number = (normalized || raw).match(/\d{5,6}/)?.[0];

    if (number) {
      values.add(number);
      values.add(`C${number}`);
      values.add(`CL${number}`);
      values.add(`S${number}`);
      values.add(`CLC${number}`);
      values.add(`SS${number}`);
    }

    return [...values].filter(Boolean);
  }

  function normalize(value) {
    return normalizePlate(value);
  }

  function readLocalUnits(selector) {
    if (!selector) return null;
    const source = document.querySelector(selector);
    if (!source) return null;

    try {
      const units = JSON.parse(source.textContent || "[]");
      return Array.isArray(units) ? units : [];
    } catch (_) {
      return [];
    }
  }

  function filterLocalUnits(units, query) {
    const variants = plateVariants(query);
    return units
      .filter(unit => {
        const placa = cleanPlate(unit.placa);
        return variants.some(variant => placa.includes(variant));
      })
      .slice(0, 20);
  }

  async function fetchUnits(query, url, signal) {
    const key = `${url}|${query}`;
    if (cache.has(key)) return cache.get(key);
    if (pending.has(key)) return pending.get(key);

    const request = fetch(`${url}?q=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json" },
      signal
    })
      .then(async response => {
        if (!response.ok) return [];
        const data = await response.json();
        const units = Array.isArray(data.unidades) ? data.unidades : [];
        cache.set(key, units);
        return units;
      })
      .catch(error => {
        if (error.name === "AbortError") return null;
        return [];
      })
      .finally(() => pending.delete(key));

    pending.set(key, request);
    return request;
  }

  function renderMessage(results, message) {
    results.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "tomza-plate-empty";
    empty.textContent = message;
    results.appendChild(empty);
    results.classList.add("is-open");
  }

  function createResultsBox(input) {
    const results = document.createElement("div");
    results.className = "tomza-plate-results";
    results.setAttribute("role", "listbox");
    input.insertAdjacentElement("afterend", results);
    return results;
  }

  function createSelectedBox(wrapper) {
    const selected = document.createElement("div");
    selected.className = "tomza-plate-selected";
    if (wrapper && wrapper.appendChild) {
      wrapper.appendChild(selected);
    }
    return selected;
  }

  function initInput(input) {
    if (!input || input.dataset.placaReady === "1") return;
    input.dataset.placaReady = "1";
    input.autocomplete = "off";
    input.classList.add("text-uppercase");

    const wrapper = input.closest("[data-placa-search]") || input.parentElement;
    if (wrapper) wrapper.classList.add("tomza-plate-search");

    const url = input.dataset.placaUrl || wrapper?.dataset.placaUrl || DEFAULT_URL;
    const sourceSelector = input.dataset.placaSource || wrapper?.dataset.placaSource || "";
    const localUnits = readLocalUnits(sourceSelector);
    const targetSelector = input.dataset.placaTarget || wrapper?.dataset.placaTarget || "";
    const target = targetSelector ? document.querySelector(targetSelector) : null;
    const mode = input.dataset.placaMode || wrapper?.dataset.placaMode || (target ? "unidad" : "placa");
    const allowFree = input.dataset.placaAllowFree === "true" || wrapper?.dataset.placaAllowFree === "true" || mode === "placa";
    const sedeTargetSelector = input.dataset.placaSedeTarget || wrapper?.dataset.placaSedeTarget || "";
    const sedeTarget = sedeTargetSelector ? document.querySelector(sedeTargetSelector) : null;
    const results = wrapper?.querySelector("[data-placa-results]") || createResultsBox(input);
    const selected = wrapper?.querySelector("[data-placa-selected]") || createSelectedBox(wrapper || input);

    results.classList.add("tomza-plate-results");
    selected.classList.add("tomza-plate-selected");
    let abortController = null;
    let debounceTimer = null;
    let lastQuery = "";
    let requestSeq = 0;

    function close() {
      results.classList.remove("is-open");
    }

    function clearSelection() {
      if (target) target.value = "";
      if (sedeTarget) sedeTarget.value = "";
      if (selected) selected.textContent = "";
    }

    function selectUnit(unit) {
      input.value = unit.placa || "";
      if (target) target.value = mode === "unidad" ? unit.id : unit.placa;
      if (sedeTarget) sedeTarget.value = unit.sede || "";
      if (selected) selected.textContent = `${unit.placa || ""} · ${unit.sede || "Sin sede"}`;
      close();
      results.innerHTML = "";
      input.dispatchEvent(new CustomEvent("placa:selected", { bubbles: true, detail: unit }));
    }

    async function renderNow() {
      const query = cleanPlate(input.value);
      if (!allowFree) clearSelection();
      if (!query || query.length < 2) {
        close();
        results.innerHTML = "";
        return;
      }

      if (abortController) abortController.abort();
      abortController = new AbortController();
      lastQuery = query;
      const seq = ++requestSeq;

      let units = [];
      units = localUnits ? filterLocalUnits(localUnits, query) : await fetchUnits(query, url, abortController.signal);
      if (units === null || seq !== requestSeq) return;

      results.innerHTML = "";
      if (!units.length) {
        renderMessage(results, "No hay placas con esa búsqueda.");
        return;
      }

      units.forEach(unit => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tomza-plate-option";
        button.innerHTML = `<strong>${unit.placa || ""}</strong><span>${unit.sede || "Sin sede"}</span>`;
        button.addEventListener("click", () => selectUnit(unit));
        results.appendChild(button);
      });
      results.classList.add("is-open");
    }

    function scheduleRender(force = false) {
      const query = cleanPlate(input.value);
      if (!force && query === lastQuery && results.innerHTML) {
        results.classList.add("is-open");
        return;
      }
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(renderNow, 250);
    }

    input.addEventListener("input", () => scheduleRender(true));
    input.addEventListener("focus", () => scheduleRender(false));
    input.addEventListener("blur", () => {
      if (!target && allowFree) input.value = normalizePlate(input.value);
    });
    input.form?.addEventListener("submit", event => {
      if (allowFree && (!target || !target.value)) {
        input.value = normalizePlate(input.value);
      }
      if (!allowFree && target && !target.value) {
        event.preventDefault();
        if (selected) selected.textContent = "Seleccione una placa de la lista.";
        input.focus();
      }
    });

    document.addEventListener("click", event => {
      if (wrapper && !wrapper.contains(event.target)) close();
    });
  }

  function initAll(root = document) {
    injectStyle();
    root.querySelectorAll("[data-placa-autocomplete]").forEach(initInput);
    root.querySelectorAll("[data-placa-search] [data-placa-input]").forEach(initInput);
    root.querySelectorAll('input[type="text"]').forEach(input => {
      const name = String(input.getAttribute("name") || "").toLowerCase();
      if (!name.includes("placa")) return;
      if (input.dataset.placaReady === "1") return;
      input.dataset.placaMode = input.dataset.placaMode || "placa";
      input.dataset.placaAllowFree = input.dataset.placaAllowFree || "true";
      initInput(input);
    });
  }

  window.TomzaPlateNormalizer = { cleanPlate, normalizePlate, plateVariants };
  window.TomzaPlacaSearch = { initAll, initInput };
  document.addEventListener("DOMContentLoaded", () => initAll());
})();

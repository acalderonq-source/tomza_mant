(function () {
  const preventivo = [
    "revision general",
    "revisión general",
    "mantenimiento",
    "programado",
    "preventivo",
    "aceite",
    "engrase",
    "filtro",
    "filtros",
    "ajuste de frenos",
    "revisar frenos",
    "revision de frenos",
    "revisión de frenos",
    "revision de luces",
    "revisión de luces",
    "chequeo",
    "inspeccion",
    "inspección"
  ];

  const correctivo = [
    "fuga",
    "no arranca",
    "no enciende",
    "quebrado",
    "quebrada",
    "dañado",
    "danado",
    "golpe",
    "falla",
    "fallando",
    "ruido",
    "varado",
    "urgente",
    "reparar",
    "reparacion",
    "reparación",
    "cambiar bomba",
    "bomba mala",
    "clutch patinando",
    "problema",
    "no funciona",
    "malo",
    "mala",
    "roto",
    "rota",
    "reventado",
    "reventada"
  ];

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }

  function score(text, words) {
    const value = normalize(text);
    return words.reduce((total, word) => {
      const clean = normalize(word);
      if (!clean || !value.includes(clean)) return total;
      return total + (clean.includes(" ") ? 3 : 1);
    }, 0);
  }

  function detect(text, fallback) {
    const p = score(text, preventivo);
    const c = score(text, correctivo);
    if (p > c) return "PREVENTIVO";
    if (c > p) return "CORRECTIVO";
    return fallback || "CORRECTIVO";
  }

  function textFromForm(form) {
    const fields = form.querySelectorAll("textarea, input[type='text'], input:not([type])");
    const fieldText = Array.from(fields)
      .filter(field => field.name !== "placa_unidad" && field.name !== "placa" && !field.closest("[data-placa-search]"))
      .map(field => field.value)
      .join(" ");
    const editorText = Array.from(form.querySelectorAll("[contenteditable='true']"))
      .map(editor => editor.textContent || "")
      .join(" ");
    return `${fieldText} ${editorText}`;
  }

  function mount(form) {
    const select = form.querySelector("select[name='tipo_mantenimiento']");
    if (!select) return;

    let touched = false;
    const label = form.querySelector("[data-tipo-mantenimiento-detectado]");

    select.addEventListener("change", () => {
      touched = true;
      if (label) label.textContent = "Tipo seleccionado manualmente.";
    });

    const update = () => {
      if (touched) return;
      if (select.value === "SUMINISTROS") {
        if (label) label.textContent = "Tipo seleccionado como suministros.";
        return;
      }
      const detected = detect(textFromForm(form), select.value || "CORRECTIVO");
      select.value = detected;
      if (label) {
        label.textContent = detected === "PREVENTIVO"
          ? "Detectado como preventivo por palabras de mantenimiento/revisión."
          : "Detectado como correctivo por reporte, falla o reparación.";
      }
    };

    form.addEventListener("input", event => {
      if (event.target === select) return;
      update();
    });

    update();
  }

  function init() {
    document.querySelectorAll("form").forEach(mount);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

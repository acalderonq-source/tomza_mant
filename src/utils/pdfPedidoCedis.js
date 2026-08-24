const fs = require("fs");
const path = require("path");
const PdfPrinter = require("pdfmake");

const fonts = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique"
  }
};

const printer = new PdfPrinter(fonts);
const DARK_BLUE = "#203A67";
const YELLOW = "#FFFF99";

function formatDate(value) {
  if (!value) return "";
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${Number(match[3])}/${Number(match[2])}/${match[1]}`;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("es-CR", {
    timeZone: "America/Costa_Rica",
    day: "numeric",
    month: "numeric",
    year: "numeric"
  });
}

function tituloSede(sede) {
  return String(sede || "")
    .trim()
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, letra => letra.toUpperCase());
}

function destinoEntrega(sede) {
  const sedeTexto = String(sede || "").trim().toLowerCase();
  if (sedeTexto === "recope_limon" || sedeTexto === "recope limon" || sedeTexto === "recope limón") return "RECOPE LIMON";
  if (sedeTexto.includes("alajuela")) return "ALAJUELA";
  return "CARTAGO";
}

function descripcionItem(item) {
  return String(item.solicitud || item.marcado_rojo || "").trim();
}

function cantidadItem(item) {
  return String(item.cantidad || "").trim();
}

function limpiarDescripcionRepuesto(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,;:-]+|[\s.,;:-]+$/g, "")
    .trim();
}

function dividirPorConjuncionInteligente(texto) {
  const keywords = [
    "aceite",
    "bateria",
    "batería",
    "bomba",
    "broca",
    "cable",
    "cables",
    "aire",
    "diesel",
    "empaque",
    "empaques",
    "escobilla",
    "escobillas",
    "faro",
    "faros",
    "fibra",
    "fibras",
    "filtro",
    "filtros",
    "luz",
    "luces",
    "manguera",
    "mangueras",
    "pastilla",
    "pastillas",
    "reten",
    "retenedor",
    "retenedores",
    "sensor",
    "sensores",
    "silenciador",
    "tambor",
    "tambores",
    "zapata",
    "zapatas"
  ];
  const regex = new RegExp(`\\s+y\\s+(?=(?:${keywords.join("|")})\\b)`, "gi");
  return texto.split(regex);
}

function normalizarFiltroLista(value) {
  const texto = limpiarDescripcionRepuesto(value);
  if (!texto) return [];

  const lower = texto.toLowerCase();
  const matchFiltro = lower.match(/^filtros?\s*(?:de\s+)?(.+)$/i);
  if (!matchFiltro) return null;

  const detalle = limpiarDescripcionRepuesto(matchFiltro[1]);
  if (!detalle) return [texto];

  const partes = detalle
    .replace(/\s+y\s+/gi, ",")
    .replace(/\s*\/\s*/g, ",")
    .split(/[\s,]+/)
    .map(limpiarDescripcionRepuesto)
    .filter(Boolean);

  const tipos = ["aceite", "diesel", "aire", "agua", "combustible", "hidraulico", "hidráulico"];
  const filtradas = partes.filter(parte => tipos.includes(parte.toLowerCase()));

  if (!filtradas.length) return [texto];

  return filtradas.map(parte => {
    const tipo = parte.toLowerCase();
    if (tipo === "aceite" || tipo === "aire" || tipo === "agua") return `Filtro de ${parte}`;
    return `Filtro ${parte}`;
  });
}

function normalizarPartesRepuestos(partes) {
  const resultado = [];
  let contextoFiltro = false;
  const tiposFiltro = new Set(["aceite", "diesel", "aire", "agua", "combustible", "hidraulico", "hidráulico"]);

  partes.forEach(parte => {
    const filtroExpandido = normalizarFiltroLista(parte);

    if (Array.isArray(filtroExpandido)) {
      contextoFiltro = true;
      resultado.push(...filtroExpandido);
      return;
    }

    const lower = parte.toLowerCase();
    if (contextoFiltro && tiposFiltro.has(lower)) {
      if (["aceite", "aire", "agua"].includes(lower)) {
        resultado.push(`Filtro de ${parte}`);
      } else {
        resultado.push(`Filtro ${parte}`);
      }
      return;
    }

    resultado.push(parte);
  });

  return resultado;
}

function dividirDescripcionRepuestos(value) {
  const texto = descripcionItem({ solicitud: value });
  if (!texto) return [""];

  const normalizado = texto
    .replace(/\r\n/g, "\n")
    .replace(/[•*]+/g, "\n")
    .replace(/\s+-\s+/g, "\n")
    .replace(/\s*(?:^|\s)(\d{1,2})[.)]\s+/g, "\n")
    .replace(/[;|/]+/g, "\n")
    .replace(/,+/g, "\n");

  const partes = normalizado
    .split(/\n+/)
    .flatMap(parte => dividirPorConjuncionInteligente(parte))
    .map(limpiarDescripcionRepuesto)
    .filter(Boolean);

  if (!partes.length) return [texto];

  const partesNormalizadas = normalizarPartesRepuestos(partes);
  const sinDuplicados = [];
  const vistos = new Set();
  partesNormalizadas.forEach(parte => {
    const clave = parte.toLowerCase();
    if (!vistos.has(clave)) {
      vistos.add(clave);
      sinDuplicados.push(parte);
    }
  });

  return sinDuplicados;
}

function expandirItemsPorRepuesto(items) {
  return (Array.isArray(items) ? items : []).flatMap(item => {
    const partes = dividirDescripcionRepuestos(descripcionItem(item));
    return partes.map((descripcion, index) => ({
      ...item,
      descripcion_dividida: descripcion,
      cantidad_dividida: index === 0 ? cantidadItem(item) : "",
      placa_dividida: item.placa || ""
    }));
  });
}

function dividirRepuestosSeleccionables(item) {
  return dividirDescripcionRepuestos(descripcionItem(item));
}

function logoTomza() {
  const logoPath = path.join(process.cwd(), "public", "img", "logo_tomza.jpg");
  if (fs.existsSync(logoPath)) {
    return { image: logoPath, fit: [178, 68], margin: [0, 6, 0, 0] };
  }
  return { text: "GAS TOMZA", bold: true, fontSize: 22, margin: [0, 16, 0, 0] };
}

function crearTablaPedido(grupo) {
  const items = expandirItemsPorRepuesto(grupo.items);
  const bodyRowsCount = Math.max(items.length, 1);
  const rowSpanMargin = Math.max(10, Math.min(118, Math.round((bodyRowsCount * 16) / 2) - 8));
  const body = [
    [
      { text: "CEDI", style: "tableHead" },
      { text: "Entregar", style: "tableHead" },
      { text: "Placa", style: "tableHead" },
      { text: "Cantidad", style: "tableHead" },
      { text: "Descripción", style: "tableHead" }
    ]
  ];

  for (let index = 0; index < bodyRowsCount; index += 1) {
    const item = items[index] || {};
    const row = [];

    if (index === 0) {
      row.push({
        text: tituloSede(grupo.sede),
        rowSpan: bodyRowsCount,
        alignment: "center",
        margin: [0, rowSpanMargin, 0, 0],
        fontSize: 12
      });
      row.push({
        text: destinoEntrega(grupo.sede),
        rowSpan: bodyRowsCount,
        alignment: "center",
        bold: true,
        fillColor: YELLOW,
        margin: [0, rowSpanMargin, 0, 0],
        fontSize: 12
      });
    } else {
      row.push({ text: "" });
      row.push({ text: "", fillColor: YELLOW });
    }

    row.push({ text: item.placa_dividida || item.placa || "", fontSize: 12, margin: [2, 2, 2, 2] });
    row.push({ text: item.cantidad_dividida || "", alignment: "center", fontSize: 11, margin: [2, 2, 2, 2] });
    row.push({ text: item.descripcion_dividida || descripcionItem(item), fontSize: 12, margin: [2, 2, 2, 2] });
    body.push(row);
  }

  return {
    table: {
      widths: [78, 84, 76, 64, "*"],
      body
    },
    layout: {
      hLineWidth: () => 0.9,
      vLineWidth: () => 0.9,
      hLineColor: () => "#000000",
      vLineColor: () => "#000000",
      paddingLeft: () => 2,
      paddingRight: () => 2,
      paddingTop: () => 0,
      paddingBottom: () => 0
    }
  };
}

function crearPaginaPedido(grupo, index) {
  return [
    ...(index > 0 ? [{ text: "", pageBreak: "before" }] : []),
    {
      table: {
        widths: ["*"],
        body: [[{ text: "Gas Tomza de Costa Rica S.A", style: "companyBar" }]]
      },
      layout: {
        hLineWidth: () => 1,
        vLineWidth: () => 1,
        hLineColor: () => "#000000",
        vLineColor: () => "#000000",
        paddingTop: () => 2,
        paddingBottom: () => 2
      }
    },
    {
      table: {
        widths: [190, "*"],
        body: [[
          logoTomza(),
          {
            stack: [
              { text: formatDate(grupo.fecha), alignment: "right", fontSize: 12, margin: [0, 18, 0, 42] },
              { text: "La lima, Cartago", alignment: "center", fontSize: 13 },
              { text: "3-101-349880", alignment: "center", fontSize: 12 },
              { text: "Telefono: 2201-6000", alignment: "center", fontSize: 12 },
              {
                text: "facelectronica@tomza.com     efernandez.m@tomza.com",
                color: "#0563C1",
                decoration: "underline",
                alignment: "center",
                fontSize: 9,
                margin: [0, 4, 0, 0]
              }
            ]
          }
        ]]
      },
      layout: {
        hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 1 : 0),
        vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 1 : 0),
        hLineColor: () => "#000000",
        vLineColor: () => "#000000",
        paddingLeft: () => 3,
        paddingRight: () => 3,
        paddingTop: () => 0,
        paddingBottom: () => 0
      }
    },
    crearTablaPedido(grupo)
  ];
}

function generarPdfPedidoCedis(grupos) {
  const content = [];
  (Array.isArray(grupos) ? grupos : []).forEach((grupo, index) => {
    content.push(...crearPaginaPedido(grupo, index));
  });

  const docDefinition = {
    pageSize: "A4",
    pageMargins: [50, 54, 50, 40],
    defaultStyle: {
      font: "Helvetica",
      fontSize: 10
    },
    styles: {
      companyBar: {
        bold: true,
        color: "#FFFFFF",
        fillColor: DARK_BLUE,
        alignment: "center",
        fontSize: 14
      },
      tableHead: {
        bold: true,
        color: "#FFFFFF",
        fillColor: DARK_BLUE,
        alignment: "center",
        fontSize: 12
      }
    },
    content: content.length ? content : [{ text: "Sin datos para generar pedido.", alignment: "center" }]
  };

  return new Promise((resolve, reject) => {
    const chunks = [];
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    pdfDoc.on("data", chunk => chunks.push(chunk));
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}

module.exports = { generarPdfPedidoCedis, dividirRepuestosSeleccionables };

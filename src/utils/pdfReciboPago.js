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

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function formatMoney(value) {
  return toNumber(value).toLocaleString("es-CR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDate(value) {
  if (!value) return "-";
  const raw = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00`)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("es-CR");
}

function text(value, fallback = "-") {
  const clean = String(value || "").trim();
  return clean || fallback;
}

function generarBuffer(docDefinition) {
  return new Promise((resolve, reject) => {
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const chunks = [];

    pdfDoc.on("data", chunk => chunks.push(chunk));
    pdfDoc.on("end", () => resolve(Buffer.concat(chunks)));
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}

function obtenerLogo(logoDataUri) {
  if (logoDataUri) return logoDataUri;

  const logoPath = path.join(process.cwd(), "public", "img", "logo_tomza.jpg");
  if (fs.existsSync(logoPath)) return logoPath;

  return null;
}

function resumenPorProveedor(facturas) {
  const map = new Map();

  facturas.forEach(factura => {
    const proveedor = text(factura.proveedor_nombre, "Sin proveedor");
    if (!map.has(proveedor)) {
      map.set(proveedor, { proveedor, facturas: 0, total: 0 });
    }

    const item = map.get(proveedor);
    item.facturas += 1;
    item.total += toNumber(factura.total);
  });

  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function observacionFactura(factura) {
  return text(
    factura.observacion ||
    factura.factura_observacion ||
    factura.abono_observacion ||
    factura.nota_credito_motivo,
    ""
  );
}

function generarFilasDetalle(facturas) {
  if (!facturas.length) {
    return [[
      { text: "-", colSpan: 6, alignment: "center", color: "#64748b", margin: [0, 6, 0, 6] },
      {}, {}, {}, {}, {}
    ]];
  }

  return facturas.map(factura => {
    const notaCredito = toNumber(factura.nota_credito_monto);
    const abono = toNumber(factura.abono_monto);
    const observacion = observacionFactura(factura);

    return [
      { text: text(factura.po_numero), style: "bodyStrong" },
      {
        stack: [
          { text: text(factura.proveedor_nombre), style: "bodyStrong" },
          observacion ? { text: `Obs.: ${observacion}`, style: "smallMuted", margin: [0, 2, 0, 0] } : null
        ].filter(Boolean)
      },
      { text: text(factura.factura), style: "bodyCell" },
      { text: formatDate(factura.fecha_vencimiento_factura), style: "bodyCell" },
      {
        stack: [
          { text: `NC: CRC ${formatMoney(notaCredito)}`, style: "smallMuted", alignment: "right" },
          { text: `Abono: CRC ${formatMoney(abono)}`, style: "smallMuted", alignment: "right" }
        ]
      },
      { text: `CRC ${formatMoney(factura.total)}`, style: "bodyStrong", alignment: "right" }
    ];
  });
}

async function generarPDFReciboPago({
  facturas = [],
  fechaPago,
  totalPagado = 0,
  logoDataUri = "",
  reciboNumero = "-",
  generadoPor = "Sistema"
} = {}) {
  const safeFacturas = Array.isArray(facturas) ? facturas : [];
  const proveedores = resumenPorProveedor(safeFacturas);
  const totalNotasCredito = safeFacturas.reduce((sum, factura) => sum + toNumber(factura.nota_credito_monto), 0);
  const totalAbonos = safeFacturas.reduce((sum, factura) => sum + toNumber(factura.abono_monto), 0);
  const logo = obtenerLogo(logoDataUri);

  const docDefinition = {
    pageSize: "LETTER",
    pageMargins: [28, 24, 28, 30],
    defaultStyle: {
      font: "Helvetica",
      fontSize: 8.5,
      color: "#111827"
    },
    footer(currentPage, pageCount) {
      return {
        margin: [28, 0, 28, 0],
        columns: [
          { text: "Sistema interno Gas Tomza - recibo generado automaticamente", color: "#64748b", fontSize: 7 },
          { text: `Pagina ${currentPage} de ${pageCount}`, alignment: "right", color: "#64748b", fontSize: 7 }
        ]
      };
    },
    content: [
      {
        table: {
          widths: [170, "*", 150],
          body: [[
            logo
              ? { image: logo, fit: [145, 55], margin: [6, 8, 6, 8] }
              : { text: "GAS TOMZA", bold: true, color: "#ffffff", margin: [8, 22, 8, 8] },
            {
              stack: [
                { text: "RECIBO DE PAGO", style: "title" },
                { text: "Control de facturas pagadas", style: "subtitle" },
                { text: "Departamento de compras / proveeduria", style: "subtitle" }
              ],
              margin: [0, 13, 0, 10]
            },
            {
              table: {
                widths: ["*"],
                body: [
                  [{ text: "RECIBO No.", style: "headerLabel" }],
                  [{ text: text(reciboNumero), style: "headerValue" }],
                  [{ text: "FECHA DE PAGO", style: "headerLabel" }],
                  [{ text: formatDate(fechaPago), style: "headerValue" }]
                ]
              },
              layout: "noBorders",
              margin: [0, 8, 8, 8]
            }
          ]]
        },
        layout: {
          fillColor: () => "#10213f",
          hLineColor: () => "#f2c200",
          vLineColor: () => "#10213f",
          hLineWidth: index => (index === 1 ? 2 : 0),
          vLineWidth: () => 0,
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 0,
          paddingBottom: () => 0
        }
      },
      {
        table: {
          widths: ["*", "*", "*", "*"],
          body: [
            [
              { text: "Empresa", style: "metaLabel" },
              { text: "Generado por", style: "metaLabel" },
              { text: "Facturas", style: "metaLabel" },
              { text: "Estado", style: "metaLabel" }
            ],
            [
              { text: "Gas Tomza de Costa Rica S.A.", style: "metaValue" },
              { text: text(generadoPor, "Sistema"), style: "metaValue" },
              { text: String(safeFacturas.length), style: "metaValue" },
              { text: "PAGADO", style: "paidBadge", alignment: "center" }
            ]
          ]
        },
        layout: "lightHorizontalLines",
        margin: [0, 10, 0, 8]
      },
      {
        columns: [
          {
            width: "*",
            table: {
              widths: ["*"],
              body: [
                [{ text: "TOTAL PAGADO", style: "metricLabel" }],
                [{ text: `CRC ${formatMoney(totalPagado)}`, style: "metricValue" }]
              ]
            },
            layout: "noBorders"
          },
          {
            width: "*",
            table: {
              widths: ["*"],
              body: [
                [{ text: "AJUSTES APLICADOS", style: "metricLabel" }],
                [{ text: `CRC ${formatMoney(totalNotasCredito + totalAbonos)}`, style: "metricValue" }]
              ]
            },
            layout: "noBorders"
          },
          {
            width: "*",
            table: {
              widths: ["*"],
              body: [
                [{ text: "PROVEEDORES", style: "metricLabel" }],
                [{ text: String(proveedores.length), style: "metricValue" }]
              ]
            },
            layout: "noBorders"
          }
        ],
        columnGap: 8,
        margin: [0, 0, 0, 10]
      },
      {
        table: {
          widths: ["*"],
          body: [[{ text: "RESUMEN POR PROVEEDOR", style: "sectionTitle" }]]
        },
        layout: "noBorders",
        margin: [0, 6, 0, 0]
      },
      {
        table: {
          headerRows: 1,
          widths: ["*", 70, 110],
          body: [
            [
              { text: "Proveedor", style: "tableHeader" },
              { text: "Facturas", style: "tableHeader", alignment: "center" },
              { text: "Monto pagado", style: "tableHeader", alignment: "right" }
            ],
            ...(proveedores.length ? proveedores.map(item => [
              { text: item.proveedor, style: "bodyStrong" },
              { text: String(item.facturas), style: "bodyCell", alignment: "center" },
              { text: `CRC ${formatMoney(item.total)}`, style: "bodyStrong", alignment: "right" }
            ]) : [[
              { text: "No hay proveedores en este recibo.", colSpan: 3, alignment: "center", color: "#64748b" },
              {}, {}
            ]])
          ]
        },
        layout: {
          hLineColor: () => "#d9e2ef",
          vLineColor: () => "#d9e2ef",
          paddingTop: () => 4,
          paddingBottom: () => 4,
          paddingLeft: () => 5,
          paddingRight: () => 5
        },
        margin: [0, 0, 0, 10]
      },
      {
        table: {
          widths: ["*"],
          body: [[{ text: "DETALLE DE FACTURAS PAGADAS", style: "sectionTitle" }]]
        },
        layout: "noBorders",
        margin: [0, 6, 0, 0]
      },
      {
        table: {
          headerRows: 1,
          widths: [56, "*", 72, 62, 86, 86],
          body: [
            [
              { text: "PO", style: "tableHeader" },
              { text: "Proveedor / observacion", style: "tableHeader" },
              { text: "Factura", style: "tableHeader" },
              { text: "Vence", style: "tableHeader" },
              { text: "Ajustes", style: "tableHeader", alignment: "right" },
              { text: "Pagado", style: "tableHeader", alignment: "right" }
            ],
            ...generarFilasDetalle(safeFacturas)
          ]
        },
        layout: {
          hLineColor: () => "#d9e2ef",
          vLineColor: () => "#d9e2ef",
          fillColor: rowIndex => (rowIndex > 0 && rowIndex % 2 === 0 ? "#f8fafc" : null),
          paddingTop: () => 4,
          paddingBottom: () => 4,
          paddingLeft: () => 4,
          paddingRight: () => 4
        }
      },
      {
        stack: [
          { text: "Notas", style: "noteHeader" },
          {
            text: "Este documento respalda el pago de las facturas indicadas. Debe conservarse junto con los comprobantes bancarios correspondientes.",
            style: "noteText"
          },
          {
            text: `Notas de credito: CRC ${formatMoney(totalNotasCredito)}    |    Abonos previos: CRC ${formatMoney(totalAbonos)}`,
            style: "noteText",
            bold: true,
            margin: [0, 5, 0, 0]
          }
        ],
        margin: [0, 8, 0, 0]
      }
    ],
    styles: {
      title: { color: "#ffffff", fontSize: 17, bold: true, alignment: "center", characterSpacing: 0.4 },
      subtitle: { color: "#dbeafe", fontSize: 8, alignment: "center", margin: [0, 2, 0, 0] },
      headerLabel: { color: "#bfdbfe", fontSize: 6.5, bold: true, alignment: "right" },
      headerValue: { color: "#ffffff", fontSize: 9, bold: true, alignment: "right", margin: [0, 0, 0, 5] },
      metaLabel: { color: "#475569", fontSize: 6.8, bold: true, fillColor: "#eef4fb" },
      metaValue: { fontSize: 8.5, bold: true },
      paidBadge: { color: "#166534", fillColor: "#dcfce7", bold: true, fontSize: 8 },
      metricLabel: { color: "#475569", bold: true, fontSize: 7, fillColor: "#f8fafc", margin: [8, 7, 8, 0] },
      metricValue: { color: "#10213f", bold: true, fontSize: 14, fillColor: "#f8fafc", margin: [8, 0, 8, 7] },
      sectionTitle: { color: "#ffffff", fillColor: "#10213f", bold: true, fontSize: 9, margin: [6, 5, 6, 5] },
      tableHeader: { color: "#1f2937", fillColor: "#eaf1fb", bold: true, fontSize: 7 },
      bodyCell: { fontSize: 8 },
      bodyStrong: { fontSize: 8, bold: true },
      smallMuted: { fontSize: 7, color: "#64748b" },
      noteHeader: { color: "#10213f", bold: true, fontSize: 8 },
      noteText: { color: "#475569", fontSize: 7.5, lineHeight: 1.2 }
    }
  };

  return generarBuffer(docDefinition);
}

module.exports = { generarPDFReciboPago };

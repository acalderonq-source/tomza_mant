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
  const number = parseFloat(value);
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
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("es-CR");
}

function getEmpresa(orden) {
  if (orden.empresa_destino === "GRANEL") {
    return {
      nombre: "GRANEL",
      direccion: "Gas Tomza de Costa Rica S.A.",
      telefono: "2201-6000",
      email: "facelectronica@tomza.com",
      cedula: "",
      logo: path.join(process.cwd(), "public", "img", "logo_tomza.jpg")
    };
  }

  if (orden.empresa_destino === "SUPER GAS") {
    return {
      nombre: "ENVASADORA SUPER GAS GLP S.A.",
      direccion: "Alajuela, San Antonio, Tejar",
      telefono: "2434-1038",
      email: "supergasfe@tomza.com",
      cedula: "3-101-044021",
      logo: path.join(process.cwd(), "public", "img", "logo_supergas.jpeg")
    };
  }

  return {
    nombre: "GAS TOMZA DE COSTA RICA S.A.",
    direccion: "Autopista Florencio del castillo, contiguo a Agrotico, La Lima.",
    telefono: "2201-6000",
    email: "facelectronica@tomza.com",
    cedula: "",
    logo: path.join(process.cwd(), "public", "img", "logo_tomza.jpg")
  };
}

function logoOrText(empresa) {
  if (empresa.logo && fs.existsSync(empresa.logo)) {
    return { image: empresa.logo, fit: [150, 58], margin: [0, 0, 0, 4] };
  }

  return { text: empresa.nombre, bold: true, fontSize: 12, margin: [0, 14, 0, 8] };
}

function infoRows(empresa, proveedor) {
  return [
    [
      { text: "DATOS DE LA EMPRESA", style: "sectionHeader" },
      { text: "DATOS DEL PROVEEDOR", style: "sectionHeader" }
    ],
    [
      { text: `Nombre: ${empresa.nombre}`, style: "infoCell" },
      { text: `Nombre: ${proveedor.nombre || "-"}`, style: "infoCell" }
    ],
    [
      { text: `Direccion: ${empresa.direccion || "-"}`, style: "infoCell" },
      { text: `Direccion: ${proveedor.direccion || "-"}`, style: "infoCell" }
    ],
    [
      { text: `Telefono: ${empresa.telefono || "-"}`, style: "infoCell" },
      { text: `Telefono: ${proveedor.telefono || "-"}`, style: "infoCell" }
    ],
    [
      { text: `Email: ${empresa.email || "-"}`, style: "infoCell" },
      { text: `Email: ${proveedor.email || "-"}`, style: "infoCell" }
    ]
  ];
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

async function generarPDFOrden(orden, proveedor = {}, lineas = []) {
  const empresa = getEmpresa(orden);
  const subtotal = toNumber(orden.subtotal);
  const montoDescuento = toNumber(orden.descuento);
  const transporte = toNumber(orden.transporte);
  const ivaPorc = orden.iva === null || orden.iva === undefined || orden.iva === "" ? 13 : toNumber(orden.iva);
  const subtotalConDescuento = Math.max(subtotal - montoDescuento, 0);
  const baseIva = subtotalConDescuento + transporte;
  const montoIva = baseIva * ivaPorc / 100;
  const total = toNumber(orden.total) || (baseIva + montoIva);

  const itemRows = lineas.length
    ? lineas.map(linea => [
        { text: linea.codigo || "-", style: "tableCell" },
        { text: linea.codigo_producto || "-", style: "tableCell" },
        { text: linea.descripcion || "-", style: "tableCell" },
        { text: formatMoney(linea.cantidad), style: "tableCell", alignment: "center" },
        { text: formatMoney(linea.precio_unitario), style: "tableCell", alignment: "right" },
        { text: formatMoney(linea.subtotal), style: "tableCell", alignment: "right" }
      ])
    : [[
        { text: "-", style: "tableCell" },
        { text: "-", style: "tableCell" },
        { text: "Sin lineas registradas", style: "tableCell" },
        { text: "-", style: "tableCell" },
        { text: "-", style: "tableCell" },
        { text: "-", style: "tableCell" }
      ]];

  const docDefinition = {
    pageSize: "LETTER",
    pageMargins: [28, 24, 28, 28],
    defaultStyle: {
      font: "Helvetica",
      fontSize: 9
    },
    content: [
      {
        columns: [
          { width: 160, stack: [logoOrText(empresa)] },
          { width: "*", text: "ORDEN DE COMPRA (PO)", style: "title", alignment: "center", margin: [0, 22, 0, 0] },
          {
            width: 155,
            table: {
              widths: ["*", "*"],
              body: [
                [
                  { text: "P.O. NUMERO", style: "miniHeader" },
                  { text: "FECHA", style: "miniHeader" }
                ],
                [
                  { text: orden.po_numero || "-", alignment: "center", bold: true },
                  { text: formatDate(orden.fecha), alignment: "center", bold: true }
                ]
              ]
            },
            layout: "lightHorizontalLines",
            margin: [0, 18, 0, 0]
          }
        ],
        columnGap: 8
      },
      {
        table: {
          widths: ["50%", "50%"],
          body: infoRows(empresa, proveedor)
        },
        layout: "lightHorizontalLines",
        margin: [0, 8, 0, 8]
      },
      {
        table: {
          widths: ["*", "*", "*", "*"],
          body: [
            [
              { text: "Cotizacion", style: "miniHeader" },
              { text: "Forma de pago", style: "miniHeader" },
              { text: "Tipo", style: "miniHeader" },
              { text: "Fecha envio", style: "miniHeader" }
            ],
            [
              { text: orden.cotizacion_nombre || orden.cotizacion || "-", alignment: "center" },
              { text: orden.forma_pago || "Credito", alignment: "center" },
              { text: orden.tipo_mantenimiento || "CORRECTIVO", alignment: "center" },
              { text: formatDate(orden.fecha_envio), alignment: "center" }
            ]
          ]
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 8]
      },
      {
        table: {
          headerRows: 1,
          widths: [62, 58, "*", 55, 78, 78],
          body: [
            [
              { text: "Placa", style: "tableHeader" },
              { text: "Codigo", style: "tableHeader" },
              { text: "Descripcion", style: "tableHeader" },
              { text: "Cantidad", style: "tableHeader" },
              { text: "Precio unitario", style: "tableHeader" },
              { text: "Subtotal", style: "tableHeader" }
            ],
            ...itemRows
          ]
        },
        layout: {
          hLineColor: () => "#d9e2ef",
          vLineColor: () => "#d9e2ef",
          paddingTop: () => 4,
          paddingBottom: () => 4
        }
      },
      {
        columns: [
          {
            width: "*",
            stack: [
              { text: "Nota:", style: "noteHeader" },
              { text: orden.observaciones || "-", style: "noteBox" }
            ],
            margin: [0, 10, 14, 0]
          },
          {
            width: 230,
            table: {
              widths: ["*", 90],
              body: [
                ["Subtotal", { text: formatMoney(subtotal), alignment: "right" }],
                ["Descuento", { text: formatMoney(montoDescuento), alignment: "right" }],
                ["Transporte", { text: formatMoney(transporte), alignment: "right" }],
                ["Subtotal gravable", { text: formatMoney(baseIva), alignment: "right" }],
                [`IVA (${formatMoney(ivaPorc)}%)`, { text: formatMoney(montoIva), alignment: "right" }],
                [
                  { text: "TOTAL", bold: true, fillColor: "#eaf2ff" },
                  { text: formatMoney(total), bold: true, alignment: "right", fillColor: "#eaf2ff" }
                ]
              ]
            },
            layout: "lightHorizontalLines",
            margin: [0, 10, 0, 0]
          }
        ]
      }
    ],
    styles: {
      title: { fontSize: 16, bold: true },
      sectionHeader: { fillColor: "#1f4e79", color: "#ffffff", bold: true, alignment: "center", margin: [0, 3, 0, 3] },
      miniHeader: { fillColor: "#1f4e79", color: "#ffffff", bold: true, alignment: "center", margin: [0, 3, 0, 3] },
      infoCell: { margin: [3, 3, 3, 3] },
      tableHeader: { fillColor: "#1f4e79", color: "#ffffff", bold: true, alignment: "center", margin: [0, 3, 0, 3] },
      tableCell: { margin: [2, 2, 2, 2] },
      noteHeader: { fillColor: "#1f4e79", color: "#ffffff", bold: true, margin: [4, 4, 4, 4] },
      noteBox: { margin: [4, 6, 4, 6] }
    }
  };

  return generarBuffer(docDefinition);
}

module.exports = { generarPDFOrden };

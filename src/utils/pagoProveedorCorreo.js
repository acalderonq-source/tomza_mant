function normalizarCorreo(value) {
  return String(value || "").trim().toLowerCase();
}

function correoValido(value) {
  const correo = normalizarCorreo(value);
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(correo);
}

function claveProveedor(factura = {}) {
  const id = Number(factura.proveedor_id);
  if (Number.isInteger(id) && id > 0) return `id:${id}`;
  const nombre = String(factura.proveedor_nombre || "").trim().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return nombre ? `nombre:${nombre}` : "sin-proveedor";
}

function agruparFacturasPorProveedor(facturas = []) {
  const grupos = new Map();
  for (const factura of facturas) {
    const clave = claveProveedor(factura);
    if (clave === "sin-proveedor") throw new Error("Una factura no tiene proveedor asociado.");
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        clave,
        proveedor_id: Number(factura.proveedor_id) || null,
        proveedor_nombre: String(factura.proveedor_nombre || "Proveedor").trim(),
        proveedor_email: normalizarCorreo(factura.proveedor_email),
        facturas: []
      });
    }
    const grupo = grupos.get(clave);
    const correo = normalizarCorreo(factura.proveedor_email);
    if (!grupo.proveedor_email && correo) grupo.proveedor_email = correo;
    grupo.facturas.push(factura);
  }
  return [...grupos.values()];
}

function construirCorreoPago({ proveedor, facturas, reciboNumero, fechaPago, totalPagado, tipoPago, comprobanteNumero, moneda = "CRC" }) {
  const simboloMoneda = moneda === "USD" ? "USD " : "₡";
  const asuntoTipo = tipoPago === "abono" ? "Abono" : "Pago";
  const proveedorAsunto = String(proveedor || "Proveedor").replace(/[\r\n]+/g, " ").trim();
  const escapeHtml = value => String(value || "").replace(/[&<>"']/g, caracter => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[caracter]);
  const monto = Number(totalPagado || 0).toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const filas = facturas.map(factura => `
    <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(factura.factura || "-")}</td>
    <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">${simboloMoneda}${Number(factura.monto_pago || factura.total || 0).toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td></tr>
  `).join("");

  return {
    subject: `${asuntoTipo} de factura${facturas.length === 1 ? "" : "s"} | ${proveedorAsunto} | ${reciboNumero}`,
    html: `<div style="font-family:Arial,sans-serif;color:#172033;max-width:680px;margin:auto">
      <h2 style="color:#123b75">Notificación de ${asuntoTipo.toLowerCase()}</h2>
      <p>Estimado proveedor <strong>${escapeHtml(proveedor)}</strong>:</p>
      <p>Adjuntamos la colilla y el comprobante disponible para el ${asuntoTipo.toLowerCase()} registrado.</p>
      <p><strong>Fecha:</strong> ${escapeHtml(fechaPago)}<br><strong>Colilla:</strong> ${escapeHtml(reciboNumero)}${comprobanteNumero ? `<br><strong>Comprobante:</strong> ${escapeHtml(comprobanteNumero)}` : ""}</p>
      <table style="border-collapse:collapse;width:100%"><thead><tr><th style="padding:8px;text-align:left">Factura</th><th style="padding:8px;text-align:right">Monto aplicado</th></tr></thead><tbody>${filas}</tbody>
      <tfoot><tr><th style="padding:8px;text-align:left">Total pagado</th><th style="padding:8px;text-align:right">${simboloMoneda}${monto}</th></tr></tfoot></table>
      <p>Saludos,<br>Gas Tomza</p></div>`
  };
}

module.exports = { normalizarCorreo, correoValido, claveProveedor, agruparFacturasPorProveedor, construirCorreoPago };

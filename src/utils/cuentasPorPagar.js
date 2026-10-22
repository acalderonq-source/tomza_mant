// Vista de cuentas por pagar sobre el consolidado de Contabilidad
// (utils/contabilidadDocumentos): no recalcula saldos, solo los agrupa.
const servicio = require('./contabilidadDocumentos');

const TRAMOS = ['Por vencer', '1–30 días', '31–60 días', '61–90 días', 'Más de 90 días', 'Sin vencimiento'];
const ORIGENES_SIN_OC = ['TALLER_INDEPENDIENTE', 'ELECTRONICA'];
const texto = v => String(v || '').trim();

function filtros(q = {}) {
  return {
    empresa: ['GAS TOMZA', 'SUPER GAS'].includes(q.empresa) ? q.empresa : '',
    moneda: ['CRC', 'USD'].includes(q.moneda) ? q.moneda : '',
    tramo: TRAMOS.includes(q.tramo) ? q.tramo : '',
    q: texto(q.q).slice(0, 120)
  };
}

function coincide(d, f) {
  if (f.empresa && d.empresa !== f.empresa) return false;
  if (f.moneda && d.moneda !== f.moneda) return false;
  if (f.tramo && d.tramoVencimiento !== f.tramo) return false;
  if (f.q && !`${d.proveedor} ${d.numero} ${d.referencia}`.toLowerCase().includes(f.q.toLowerCase())) return false;
  return true;
}

// Dónde se paga o se corrige cada factura: siempre en su módulo de origen.
function enlacePago(d) {
  if (d.origen === 'TALLER' || d.origen === 'TALLER_INDEPENDIENTE') {
    return d.proveedorId ? `/compras/facturas?${new URLSearchParams({ proveedor_id: d.proveedorId, pagada: '0' })}` : '/compras/facturas';
  }
  if (d.origen === 'PROVEEDURIA') return d.portal ? `/proveeduria/portal-proveedores/facturas#portal-factura-${d.id}` : `/proveeduria/ordenes/${d.id}`;
  if (d.origen === 'CARBURACION') return '/carburacion/facturas';
  return '/compras/facturas';
}

function sumar(lista) {
  return lista.reduce((s, d) => s + d.saldo, 0);
}

function construir(docs, q = {}) {
  const f = filtros(q);
  const facturas = docs.filter(d => d.tipo === 'factura' && d.saldo > 0 && coincide(d, f));
  const confirmadas = facturas.filter(d => d.incluido);
  const sinOrden = facturas.filter(d => ORIGENES_SIN_OC.includes(d.origen));
  const otrasExcluidas = facturas.filter(d => !d.incluido && !ORIGENES_SIN_OC.includes(d.origen));

  const monedas = ['CRC', 'USD'].filter(m => !f.moneda || m === f.moneda);
  const resumen = monedas.map(moneda => {
    const grupo = confirmadas.filter(d => d.moneda === moneda);
    return {
      moneda,
      saldo: sumar(grupo),
      vencido: sumar(grupo.filter(d => d.diasVencidos > 0)),
      facturas: grupo.length,
      sinOrden: sumar(sinOrden.filter(d => d.moneda === moneda)),
      porRevisar: sumar(otrasExcluidas.filter(d => d.moneda === moneda))
    };
  });
  // Facturas sin OC cuya moneda aún no está confirmada: se informan aparte, sin convertir.
  const sinOrdenSinMoneda = { facturas: sinOrden.filter(d => !d.moneda).length, saldo: sumar(sinOrden.filter(d => !d.moneda)) };
  const antiguedad = monedas.map(moneda => ({
    moneda,
    tramos: TRAMOS.map(tramo => {
      const grupo = confirmadas.filter(d => d.moneda === moneda && d.tramoVencimiento === tramo);
      return { tramo, facturas: grupo.length, saldo: sumar(grupo) };
    })
  }));
  const ordenar = (a, b) => b.diasVencidos - a.diasVencidos || String(a.vencimiento || '9999').localeCompare(String(b.vencimiento || '9999')) || String(a.proveedor || '').localeCompare(String(b.proveedor || ''), 'es');
  const conEnlace = d => ({ ...d, urlPago: enlacePago(d) });
  return {
    filtros: f,
    tramos: TRAMOS,
    resumen,
    sinOrdenSinMoneda,
    antiguedad,
    proveedores: servicio.porProveedor(confirmadas),
    detalle: confirmadas.sort(ordenar).map(conEnlace),
    sinOrden: sinOrden.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).map(conEnlace),
    otrasExcluidas: otrasExcluidas.map(conEnlace)
  };
}

module.exports = { construir, enlacePago, filtros, TRAMOS };

const EMPRESAS = ['GAS TOMZA', 'SUPER GAS'];

function fechaValida(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function centavos(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) throw new Error('Indique un monto válido, con un máximo de dos decimales.');
  const [entero, decimal = ''] = text.split('.');
  return Number(entero) * 100 + Number(decimal.padEnd(2, '0'));
}

function datosDocumento(body) {
  if (!EMPRESAS.includes(body.empresa)) throw new Error('Seleccione Gas Tomza o Súper Gas.');
  if (!fechaValida(body.fecha)) throw new Error('Indique una fecha válida.');
  const monto = centavos(body.monto) / 100;
  const proveedor = String(body.proveedor || '').trim().slice(0, 180);
  const numero = String(body.numero_factura || '').trim().slice(0, 100);
  if (!proveedor || !numero || monto <= 0) throw new Error('Complete proveedor, número de factura y monto mayor a cero.');
  return { monto, proveedor, numero };
}

function monedaCRC(value) {
  return ['CRC', 'COLONES', 'COLON', '₡'].includes(String(value || '').trim().toUpperCase());
}

module.exports = { EMPRESAS, fechaValida, centavos, datosDocumento, monedaCRC };

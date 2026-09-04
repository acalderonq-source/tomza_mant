function sumar(items = [], predicate = () => true) {
  return items
    .filter(predicate)
    .reduce((total, item) => total + Number(item.monto ?? item.total ?? 0), 0);
}

function contar(items = [], predicate = () => true) {
  return items
    .filter(predicate)
    .reduce((total, item) => total + Number(item.registros ?? 1), 0);
}

function construirResumenFinanciero({ gastos = [], facturasPagadasRow = {} } = {}) {
  const esOrden = item => item.fuente === "ORDEN";
  const esOrdenMotor = item => item.fuente === "ORDEN_MOTOR";
  const esPagoProveedor = item => item.fuente === "PAGO_PROVEEDOR";
  const esCajaChica = item => item.fuente === "CAJA_CHICA";
  const esReintegroGastos = item => item.fuente === "REINTEGRO_GASTOS";
  const esPagadoProveedor = item => esPagoProveedor(item) && Number(item.pagada || 0) === 1;
  const esPendienteProveedor = item => esPagoProveedor(item) && Number(item.pagada || 0) !== 1;
  const esMantenimiento = item => esOrden(item) || esOrdenMotor(item);
  const esCorrectivo = item => esMantenimiento(item) && item.tipo_mantenimiento === "CORRECTIVO";
  const esPreventivo = item => esMantenimiento(item) && item.tipo_mantenimiento === "PREVENTIVO";
  const esSuministro = item => esMantenimiento(item) && item.tipo_mantenimiento === "SUMINISTROS";

  const totalOrdenesCompra = sumar(gastos, esOrden);
  const totalOrdenesMotor = sumar(gastos, esOrdenMotor);
  const totalPagosProveedor = sumar(gastos, esPagoProveedor);
  const totalPagosProveedorPagados = sumar(gastos, esPagadoProveedor);
  const totalPagosProveedorPendientes = sumar(gastos, esPendienteProveedor);
  const totalCajaChica = sumar(gastos, esCajaChica);
  const totalReintegrosGastos = sumar(gastos, esReintegroGastos);
  const totalFacturasPagadas = Number(facturasPagadasRow.total || 0);
  const movimientosFacturasPagadas = Number(facturasPagadasRow.movimientos || facturasPagadasRow.registros || 0);

  const totalOrdenesMotorPagadas = totalOrdenesMotor;
  const movimientosOrdenesMotorPagadas = contar(gastos, esOrdenMotor);
  const movimientosCajaChica = contar(gastos, esCajaChica);
  const totalGeneral = totalOrdenesCompra + totalOrdenesMotor + totalPagosProveedor + totalCajaChica + totalReintegrosGastos;
  const totalPagado = totalFacturasPagadas + totalOrdenesMotorPagadas + totalPagosProveedorPagados + totalCajaChica;
  const movimientosTotalPagado = movimientosFacturasPagadas + movimientosOrdenesMotorPagadas + contar(gastos, esPagadoProveedor) + movimientosCajaChica;

  return {
    totalGeneral,
    totalGastos: totalGeneral,
    totalOrdenes: totalOrdenesCompra,
    totalOrdenesCompra,
    totalOrdenesMotor,
    totalGastoCorrectivo: sumar(gastos, esCorrectivo),
    totalGastoPreventivo: sumar(gastos, esPreventivo),
    totalGastoSuministros: sumar(gastos, esSuministro),
    totalOrdenesMotorPagadas,
    totalPagosProveedor,
    totalPagosProveedorPagados,
    totalPagosProveedorPendientes,
    totalCajaChica,
    totalReintegrosGastos,
    totalFacturasPagadas,
    totalPagado,
    movimientosGeneral: contar(gastos),
    registros: contar(gastos),
    movimientosOrdenes: contar(gastos, esOrden),
    movimientosOrdenesCompra: contar(gastos, esOrden),
    movimientosOrdenesMotor: contar(gastos, esOrdenMotor),
    movimientosGastoCorrectivo: contar(gastos, esCorrectivo),
    movimientosGastoPreventivo: contar(gastos, esPreventivo),
    movimientosGastoSuministros: contar(gastos, esSuministro),
    movimientosOrdenesMotorPagadas,
    movimientosPagosProveedor: contar(gastos, esPagoProveedor),
    movimientosPagosProveedorPagados: contar(gastos, esPagadoProveedor),
    movimientosPagosProveedorPendientes: contar(gastos, esPendienteProveedor),
    movimientosCajaChica,
    movimientosReintegrosGastos: contar(gastos, esReintegroGastos),
    movimientosFacturasPagadas,
    movimientosTotalPagado
  };
}

function totalLista(items = []) {
  return items.reduce((total, item) => total + Number(item.total || 0), 0);
}

function auditarResumenFinanciero({ totalGastos = 0, negocios = [], rubros = [] } = {}) {
  const totalNegocios = totalLista(negocios);
  const totalRubros = totalLista(rubros);
  const diferenciaNegocios = Number(totalGastos || 0) - totalNegocios;
  const diferenciaRubros = Number(totalGastos || 0) - totalRubros;

  return {
    totalGastos: Number(totalGastos || 0),
    totalNegocios,
    totalRubros,
    diferenciaNegocios,
    diferenciaRubros,
    consistenteNegocios: Math.abs(diferenciaNegocios) < 0.01,
    consistenteRubros: Math.abs(diferenciaRubros) < 0.01
  };
}

module.exports = {
  construirResumenFinanciero,
  auditarResumenFinanciero
};

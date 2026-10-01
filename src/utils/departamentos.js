const DEPARTAMENTOS = [
  { key: "TALLER", nombre: "Taller", icono: "bi-tools", descripcion: "Mantenimientos, repuestos y bodega del taller." },
  { key: "OPERACIONES", nombre: "Operaciones", icono: "bi-truck", descripcion: "Unidades, rutas, lavados y control operativo." },
  { key: "CONTABILIDAD", nombre: "Contabilidad", icono: "bi-journal-check", descripcion: "Facturas, asientos y controles contables." },
  { key: "SEGURIDAD_OCUPACIONAL", nombre: "Seguridad Ocupacional", icono: "bi-shield-check", descripcion: "Área lista para incorporar sus procesos." },
  { key: "LOGISTICA", nombre: "Logística", icono: "bi-diagram-3", descripcion: "Área lista para incorporar sus procesos." },
  { key: "PROVEEDURIA", nombre: "Proveeduría", icono: "bi-box-seam", descripcion: "Compras, órdenes y suministros." },
  { key: "RECURSOS_HUMANOS", nombre: "Recursos Humanos", icono: "bi-people", descripcion: "Área lista para incorporar sus procesos." }
];

const DEPARTAMENTO_POR_CLAVE = new Map(DEPARTAMENTOS.map(departamento => [departamento.key, departamento]));

function departamentosInicialesPorRol(rol) {
  const asignaciones = {
    ADMIN: DEPARTAMENTOS.map(({ key }) => key),
    TALLER: ["TALLER", "OPERACIONES", "PROVEEDURIA"],
    MECANICO: ["TALLER"],
    SUPERVISOR: ["OPERACIONES", "TALLER"],
    SUPERVISOR_PESADO: ["OPERACIONES"],
    CONTABILIDAD: ["CONTABILIDAD"],
    PROVEEDURIA: ["PROVEEDURIA"],
    PROVEEDURIA_TALLER: ["PROVEEDURIA", "TALLER"],
    BODEGA: ["PROVEEDURIA", "TALLER"],
    BODEGUERO: ["PROVEEDURIA", "TALLER"],
    TRAMITES: ["OPERACIONES", "LOGISTICA"],
    MENSAJERO: ["LOGISTICA"]
  };
  return asignaciones[String(rol || "").toUpperCase()] || ["TALLER"];
}

function esDepartamentoValido(departamento) {
  return DEPARTAMENTO_POR_CLAVE.has(String(departamento || "").toUpperCase());
}

module.exports = { DEPARTAMENTOS, departamentosInicialesPorRol, esDepartamentoValido };

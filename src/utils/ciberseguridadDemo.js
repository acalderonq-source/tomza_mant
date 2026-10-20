const TIPOS = ['Phishing', 'Fuerza bruta', 'Malware', 'Escaneo de puertos', 'Acceso sospechoso'];
const SEDES = ['Administración', 'Taller', 'Operaciones', 'Proveeduría'];
const GRAVEDADES = ['Baja', 'Media', 'Alta', 'Crítica'];
// Conjunto reproducible y aislado: no representa actividad real del sistema.
function incidentesDemo() {
  const rows = [];
  for (let dia = 0; dia < 30; dia++) {
    for (let i = 0; i < 4 + (dia * 7 % 9); i++) {
      const n = dia * 13 + i;
      rows.push({ id: `DEMO-${String(rows.length + 1).padStart(4, '0')}`,
        fecha: new Date(Date.UTC(2026, 8, 21 + dia, 7 + i, (n * 11) % 60)).toISOString(),
        tipo: TIPOS[n % 5], gravedad: GRAVEDADES[n % 4], sede: SEDES[(dia + i * 3) % 4],
        equipo: `TOMZA-${String(1 + n % 24).padStart(2, '0')}`,
        origen: `192.0.2.${1 + n % 254}`, estado: n % 11 === 0 ? 'En investigación' : n % 7 === 0 ? 'Contenido' : 'Bloqueado' });
    }
  }
  return rows.reverse();
}
function resumenDemo(dias = 30, gravedad = 'Todas') {
  const desde = Date.UTC(2026, 9, 21 - dias);
  const incidentes = incidentesDemo().filter(row => Date.parse(row.fecha) >= desde && (gravedad === 'Todas' || row.gravedad === gravedad));
  const tendencia = Array.from({ length: dias }, (_, i) => {
    const fecha = new Date(desde + i * 86400000).toISOString().slice(0, 10);
    const rows = incidentes.filter(row => row.fecha.startsWith(fecha));
    return { fecha, detectados: rows.length, bloqueados: rows.filter(row => row.estado === 'Bloqueado').length };
  });
  return { demo: true, periodo: { desde: tendencia[0].fecha, hasta: '2026-10-20' }, incidentes, tendencia,
    tipos: TIPOS.map(tipo => ({ tipo, total: incidentes.filter(row => row.tipo === tipo).length })),
    total: incidentes.length, bloqueados: incidentes.filter(row => row.estado === 'Bloqueado').length,
    pendientes: incidentes.filter(row => row.estado === 'En investigación').length,
    criticos: incidentes.filter(row => row.gravedad === 'Crítica').length };
}
module.exports = { resumenDemo, GRAVEDADES };

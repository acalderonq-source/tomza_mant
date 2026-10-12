function normalizarSede(sede) {
  return String(sede || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function nombreCedi(sede) {
  const clave = normalizarSede(sede);
  const etiquetas = {
    perez_zeledon: "PZ",
    granel_perez_zeledon: "PZ",
    granel_cartago: "Cartago",
    granel_guapiles: "Guapiles",
    granel_alajuela: "Alajuela",
    granel_la_cruz: "La Cruz",
    cabezales: "Transportadora",
    cisternas: "Transportadora",
    carretas: "Transportadora",
    tandem: "Transportadora",
    transportadora: "Transportadora"
  };
  return etiquetas[clave] || String(sede || "").trim();
}

function destinoEntrega(sede) {
  const clave = normalizarSede(sede);
  if (["nicoya", "la_cruz", "granel_la_cruz"].includes(clave)) return "GUANACASTE";
  if (["guapiles", "granel_guapiles", "orotina", "alajuela", "granel_alajuela", "san_carlos", "rio_claro"].includes(clave)) {
    return "ALAJUELA";
  }
  return "CARTAGO";
}

function prepararCotizacion(solicitudes) {
  const ordenSedes = [
    "Cartago", "PZ", "Guapiles", "Orotina", "Alajuela", "San Carlos", "Rio Claro", "Nicoya", "La Cruz",
    "Transportadora", "Granel", "Tecnicos", "Taller"
  ];
  const ordenEntrega = { CARTAGO: 1, ALAJUELA: 2, GUANACASTE: 3 };
  const filas = solicitudes
    .map(solicitud => ({
      ...solicitud,
      cedi: nombreCedi(solicitud.sede),
      entregar: destinoEntrega(solicitud.sede),
      descripcion: [solicitud.medida, solicitud.marca_sugerida, solicitud.posicion].filter(Boolean).join(", ")
    }))
    .sort((a, b) => {
      const entrega = (ordenEntrega[a.entregar] || 99) - (ordenEntrega[b.entregar] || 99);
      if (entrega) return entrega;
      const indiceA = ordenSedes.indexOf(a.cedi);
      const indiceB = ordenSedes.indexOf(b.cedi);
      if (indiceA !== indiceB) return (indiceA < 0 ? 99 : indiceA) - (indiceB < 0 ? 99 : indiceB);
      return String(a.placa || "").localeCompare(String(b.placa || ""));
    });

  const grupos = [];
  for (const fila of filas) {
    let grupo = grupos[grupos.length - 1];
    if (!grupo || grupo.entregar !== fila.entregar) {
      grupo = { entregar: fila.entregar, filas: [] };
      grupos.push(grupo);
    }
    grupo.filas.push(fila);
  }

  return {
    grupos,
    totalUnidades: filas.reduce((total, fila) => total + (parseInt(fila.cantidad, 10) || 0), 0)
  };
}

module.exports = { normalizarSede, nombreCedi, destinoEntrega, prepararCotizacion };

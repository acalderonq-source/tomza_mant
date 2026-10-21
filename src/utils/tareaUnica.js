// Evita que una tarea programada se encime consigo misma: si la ejecución
// anterior no ha terminado, la nueva se omite. Los errores se registran y no
// detienen las siguientes ejecuciones.
function tareaSinEncimar(nombre, tarea, { log = console } = {}) {
  let enCurso = false;
  return async function ejecutar(...args) {
    if (enCurso) {
      log.warn(`${nombre}: la ejecución anterior sigue en curso; se omite esta vuelta.`);
      return { omitida: true };
    }
    enCurso = true;
    try {
      return { omitida: false, resultado: await tarea(...args) };
    } catch (error) {
      log.error(`${nombre}:`, error?.code || error?.message || error);
      return { omitida: false, error };
    } finally {
      enCurso = false;
    }
  };
}

module.exports = { tareaSinEncimar };

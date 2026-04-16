function getSedesPermitidas(req) {
  const user = req.session.user;
  let sedes = [];

  if (user.rol === "ADMIN") {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      sedes = [req.session.sedeSeleccionada];
    } else {
      sedes = ["Cartago", "Guapiles","La Cruz", "Transportadora", "Granel", "Alajuela"]; // todas las sedes disponibles
    }
  } else if (user.usuario === "pesados") {
    if (req.session.sedeSeleccionada) {
      sedes = [req.session.sedeSeleccionada];
    } else {
      sedes = ["Transportadora"]; // por defecto
    }
  } else {
    sedes = [user.sede];
  }

  return sedes;
}

module.exports = { getSedesPermitidas };

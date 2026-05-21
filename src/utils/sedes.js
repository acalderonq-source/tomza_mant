function getSedesPermitidas(req) {
  const user = req.session.user;
  let sedes = [];

  if (user.rol === "ADMIN") {

    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS"
    ) {

      sedes = [req.session.sedeSeleccionada];

    } else {

      sedes = [
        "Cartago",
        "Guapiles",
        "La Cruz",
        "Transportadora",
        "Granel",
        "Alajuela",
        "Tecnicos",
        "Taller",
        "San Carlos",
        "Rio Claro",
        "Perez Zeledon",
        "Nicoya"
      ];

    }

  } else if (user.usuario === "pesados") {

    if (req.session.sedeSeleccionada) {

      sedes = [req.session.sedeSeleccionada];

    } else {

      sedes = ["Transportadora"];

    }

  } else {

    sedes = [user.sede];

  }

  return sedes;
}

module.exports = { getSedesPermitidas };
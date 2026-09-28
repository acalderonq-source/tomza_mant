const ZONA_HORARIA_COSTA_RICA = "America/Costa_Rica";

process.env.TZ = ZONA_HORARIA_COSTA_RICA;

function fechaActualCostaRica(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA_COSTA_RICA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function fechaHoraCostaRica(date = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: ZONA_HORARIA_COSTA_RICA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).format(date).replace(" ", "T");
}

module.exports = {
  ZONA_HORARIA_COSTA_RICA,
  fechaActualCostaRica,
  fechaHoraCostaRica
};

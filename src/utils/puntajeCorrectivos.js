const reglas = [
  { palabra: "motor", puntos: 15 },
  { palabra: "clutch", puntos: 10 },
  { palabra: "embrague", puntos: 10 },
  { palabra: "caja", puntos: 12 },
  { palabra: "transmision", puntos: 12 },
  { palabra: "bomba", puntos: 6 },
  { palabra: "freno", puntos: 5 },
  { palabra: "sensor", puntos: 3 },
  { palabra: "inyector", puntos: 4 },
  { palabra: "aceite", puntos: 2 },
  { palabra: "engrase", puntos: 1 }
];

function calcularPuntos(texto) {

  if (!texto) return 1;

  texto = texto.toLowerCase();

  let puntos = 1;

  reglas.forEach(r => {
    if (texto.includes(r.palabra)) {
      puntos = Math.max(puntos, r.puntos);
    }
  });

  return puntos;
}

module.exports = calcularPuntos;
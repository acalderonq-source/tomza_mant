const MAX_BYTES = 4 * 1024 * 1024;
function validarDatos(body = {}) {
  const titulo = typeof body.titulo === 'string' ? body.titulo.trim() : '';
  const orden = Number(body.orden ?? 0);
  if (!titulo || titulo.length > 120) throw new Error('Ingrese un titulo de hasta 120 caracteres.');
  if (!Number.isInteger(orden) || orden < 0 || orden > 9999) throw new Error('El orden debe estar entre 0 y 9999.');
  if (![undefined, false, true, '0', '1', 0, 1].includes(body.activa)) throw new Error('Estado invalido.');
  return { titulo, orden, activa: ['1', 1, true].includes(body.activa) ? 1 : 0 };
}
function validarImagen(base64) {
  if (typeof base64 !== 'string' || !base64.length || base64.length > Math.ceil(MAX_BYTES / 3) * 4 ||
      base64.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('Adjunte una imagen PNG, JPG o WebP de hasta 4 MB.');
  }
  const imagen = Buffer.from(base64, 'base64');
  if (!imagen.length || imagen.length > MAX_BYTES || imagen.toString('base64') !== base64) throw new Error('Imagen invalida o demasiado grande.');
  let mime;
  if (imagen.length >= 33 && imagen.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && imagen.subarray(12, 16).toString() === 'IHDR') mime = 'image/png';
  if (imagen.length >= 20 && imagen.subarray(0, 3).toString('hex') === 'ffd8ff' && imagen.subarray(-2).toString('hex') === 'ffd9') mime = 'image/jpeg';
  if (imagen.length >= 20 && imagen.subarray(0, 4).toString() === 'RIFF' && imagen.subarray(8, 12).toString() === 'WEBP') mime = 'image/webp';
  if (!mime) throw new Error('Solo se permiten imagenes PNG, JPG o WebP. No se admiten SVG ni documentos.');
  return { imagen, mime, tamanio: imagen.length };
}
function idValido(value) {
  return /^[1-9]\d{0,9}$/.test(String(value)) && Number(value) <= 2147483647;
}
module.exports = { MAX_BYTES, validarDatos, validarImagen, idValido };

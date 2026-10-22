// Render recibe el tráfico a través de Cloudflare, así que req.ip es la IP del
// servidor de Cloudflare y no la de la persona. Cloudflare informa la IP real en
// CF-Connecting-IP; solo se usa cuando la conexión viene de una red de Cloudflare,
// para que nadie pueda inventar su IP enviando esa cabecera directamente.
const { BlockList, isIP } = require('node:net');

// Rangos publicados en https://www.cloudflare.com/ips/
const CLOUDFLARE_IPV4 = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
  '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15',
  '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22'];
const CLOUDFLARE_IPV6 = ['2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32'];

const cloudflare = new BlockList();
for (const red of CLOUDFLARE_IPV4) { const [ip, bits] = red.split('/'); cloudflare.addSubnet(ip, Number(bits), 'ipv4'); }
for (const red of CLOUDFLARE_IPV6) { const [ip, bits] = red.split('/'); cloudflare.addSubnet(ip, Number(bits), 'ipv6'); }

function normalizar(ip) {
  const valor = String(ip || '').trim();
  return valor.startsWith('::ffff:') && isIP(valor.slice(7)) === 4 ? valor.slice(7) : valor;
}

function esCloudflare(ip) {
  const valor = normalizar(ip);
  const version = isIP(valor);
  return version === 4 ? cloudflare.check(valor, 'ipv4') : version === 6 ? cloudflare.check(valor, 'ipv6') : false;
}

function ipCliente(req) {
  const conexion = normalizar(req.ip);
  const informada = normalizar(req.headers?.['cf-connecting-ip']);
  return esCloudflare(conexion) && isIP(informada) ? informada : conexion;
}

// Reemplaza req.ip para que límites de intentos, registros de ingreso y
// ciberseguridad usen la misma IP real.
function usarIpCliente(req, _res, next) {
  const ip = ipCliente(req);
  if (ip && ip !== req.ip) Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true });
  next();
}

module.exports = { usarIpCliente, ipCliente, esCloudflare };

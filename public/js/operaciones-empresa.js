(() => {
  const protectedPath = path => /^\/compras\/(ordenes|ordenes\/consignacion-consumo|facturas\/pagar-multiple|facturas\/[^/]+\/(pagar|abono))\/?$/.test(path);
  const prepare = form => {
    if (form.method.toUpperCase() !== 'POST' || !protectedPath(new URL(form.action, location.href).pathname)) return;
    if (form.querySelector('[name="_operacion"]')) return;
    const input = document.createElement('input');
    input.type = 'hidden'; input.name = '_operacion'; input.value = crypto.randomUUID();
    form.appendChild(input);
  };
  const init = () => document.querySelectorAll('form').forEach(prepare);
  init();
  document.addEventListener('submit', event => prepare(event.target), true);
})();

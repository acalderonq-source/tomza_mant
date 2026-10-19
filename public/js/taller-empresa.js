document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.classList.contains('taller-empresa')) return;
  const desktop = window.matchMedia('(min-width: 1100px) and (pointer: fine)');
  const sidebar = document.createElement('nav');
  sidebar.className = 'taller-desktop-sidebar';
  sidebar.setAttribute('aria-label', 'Navegación de Taller');
  const brand = document.createElement('div');
  brand.className = 'taller-sidebar-brand';
  brand.textContent = 'TALLER';
  sidebar.appendChild(brand);
  const links = new Map([
    ['/dashboard', 'Inicio'],
    ['/taller/dashboard', 'Panel operativo'],
    ['/mantenimientos', 'Mantenimientos']
  ]);
  // Reutilizar accesos ya autorizados y renderizados, nunca copiar permisos entre sesiones.
  document.querySelectorAll('.module-card[href], .navbar a[href]').forEach(anchor => {
    const href = anchor.getAttribute('href');
    if (!href.startsWith('/') || href === '/logout' || href.includes('?') || href.startsWith('/descargas/')) return;
    const label = anchor.querySelector('.module-title')?.textContent || anchor.textContent;
    links.set(href, label.trim());
  });
  const groups = new Map([
    ['Unidades', []], ['Mantenimientos', []], ['Compras', []],
    ['Bodega y suministros', []], ['Gestión', []]
  ]);
  const groupFor = href => {
    if (/^\/(unidades|reportes-supervisores|lavado-unidades|revision-ruta|giras|dekra|minae)(\/|$)/.test(href)) return 'Unidades';
    if (/^\/(compras|proveeduria|ordenes-motor|contabilidad)(\/|$)/.test(href)) return 'Compras';
    if (/^\/(bodega|repuestos|repuestos-semanales|aceite)(\/|$)/.test(href)) return 'Bodega y suministros';
    if (/^\/(mantenimientos|taller|kpis|logistica-taller|llantas|aires|control-cambios-aceite)(\/|$)/.test(href)) return 'Mantenimientos';
    return 'Gestión';
  };
  const createLink = (href, label) => {
    const anchor = document.createElement('a');
    anchor.href = href; anchor.textContent = label;
    if (window.location.pathname === href) anchor.setAttribute('aria-current', 'page');
    return anchor;
  };
  sidebar.appendChild(createLink('/inicio', 'Inicio empresarial'));
  sidebar.appendChild(createLink('/dashboard', 'Inicio del departamento'));
  for (const [href, label] of links) {
    if (href !== '/dashboard') groups.get(groupFor(href)).push([href, label]);
  }
  for (const [name, entries] of groups) {
    if (!entries.length) continue;
    const group = document.createElement('details');
    group.className = 'taller-sidebar-group';
    const summary = document.createElement('summary');
    summary.textContent = name;
    group.appendChild(summary);
    const children = document.createElement('div');
    children.className = 'taller-sidebar-children';
    for (const [href, label] of entries) children.appendChild(createLink(href, label));
    group.appendChild(children);
    group.open = entries.some(([href]) => window.location.pathname === href);
    sidebar.appendChild(group);
  }
  document.body.appendChild(sidebar);
  const topbar = document.querySelector('.navbar');
  const updateDesktop = () => {
    document.body.classList.toggle('taller-desktop', desktop.matches);
    sidebar.hidden = !desktop.matches;
    if (topbar) document.body.style.setProperty('--taller-header-height', topbar.getBoundingClientRect().height + 'px');
  };
  desktop.addEventListener('change', updateDesktop);
  if (topbar && window.ResizeObserver) new ResizeObserver(updateDesktop).observe(topbar);
  updateDesktop();
  const grid = document.querySelector('.module-grid');
  if (!grid) return;
  const previousTitle = grid.previousElementSibling;
  if (previousTitle?.classList.contains('legacy-modules-title')) previousTitle.hidden = true;
  const toolbar = document.createElement('div');
  toolbar.className = 'taller-module-toolbar';
  const title = document.createElement('h2');
  title.className = 'section-title mb-0'; title.textContent = 'Aplicaciones de Taller';
  const search = document.createElement('input');
  search.type = 'search'; search.className = 'form-control'; search.placeholder = 'Buscar aplicación';
  search.setAttribute('aria-label', 'Buscar aplicación de Taller');
  toolbar.append(title, search); grid.before(toolbar);
  const empty = document.createElement('p');
  empty.className = 'taller-module-empty'; empty.textContent = 'No hay aplicaciones con ese nombre.';
  empty.setAttribute('role', 'status'); empty.hidden = true; grid.after(empty);
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  search.addEventListener('input', () => {
    const query = normalize(search.value.trim());
    const cards = [...grid.querySelectorAll('.module-card')];
    cards.forEach(card => { card.hidden = !normalize(card.textContent).includes(query); });
    empty.hidden = cards.some(card => !card.hidden);
  });
});

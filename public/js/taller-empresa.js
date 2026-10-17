document.addEventListener('DOMContentLoaded', () => {
  if (!document.body.classList.contains('taller-empresa')) return;
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

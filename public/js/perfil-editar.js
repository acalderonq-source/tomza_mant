document.addEventListener('DOMContentLoaded',()=>{
  const buscar=document.getElementById('buscar-perfil');
  buscar?.addEventListener('input',()=>document.querySelectorAll('[data-perfil]').forEach(fila=>{fila.hidden=!fila.dataset.perfil.includes(buscar.value.trim().toLowerCase());}));
  const form=document.querySelector('[data-editar-perfil]');if(!form)return;
  const modo=form.elements.modo,permisos=form.querySelector('[data-permisos-perfil]');
  const actualizar=()=>{permisos.disabled=modo.value!=='personal';permisos.hidden=permisos.disabled;};
  modo.addEventListener('change',actualizar);actualizar();
  form.addEventListener('submit',event=>{if(!window.confirm('¿Guardar los cambios para todas las personas que utilizan este perfil?'))event.preventDefault();});
});

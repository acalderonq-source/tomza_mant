# Helmet

Helmet 8 se aplica globalmente mediante securityHeaders antes de recursos, rutas, sesiones y errores. La dependencia se fija en package-lock.json.

- Conserva X-Frame-Options SAMEORIGIN, MIME nosniff y Referrer-Policy same-origin.
- Agrega aislamiento de recursos del mismo origen, Origin-Agent-Cluster, bloqueo de politicas de plugins y X-XSS-Protection 0 para desactivar filtros antiguos.
- COOP same-origin-allow-popups conserva compatibilidad con autenticacion externa.
- HSTS de 180 dias solo si req.secure es verdadero, incluyendo HTTPS recibido por el proxy confiable de Render. No aplica a HTTP de localhost, ni incluye subdominios o preload.
- CSP explicita con default-src self, sin comodines, unsafe-inline ni unsafe-eval. Cada respuesta tiene un nonce aleatorio. Solo el codigo fuente de las plantillas EJS confiables recibe ese nonce antes de renderizar datos; nunca se autoriza un script aparecido en datos del usuario.
- Los eventos inline conocidos se convierten en acciones declarativas gestionadas por eventos-seguros.js. Los estilos de atributos se analizan con css-tree y se convierten en reglas acotadas; se rechazan URL, expression y declaraciones invalidas.
- Los recursos CDN autorizados tienen versiones fijas, SHA384 y crossorigin. Las paginas renderizadas no se almacenan en cache para evitar reutilizar nonces o informacion privada.
- No activa COEP ni bloquea permisos de camara. CSRF, sesiones y permisos siguen siendo controles separados.
- Las rutas de adjuntos conservan su CSP sandbox especifica.

Pruebas HTTP en tests/helmet.test.js y pruebas de navegador del mapa y camara con el mismo middleware. Referencia: https://helmet.js.org/.

Los avisos ZAP de autenticacion y gestion de sesion son informativos, no motivo para quitar esos controles. Un aviso de atributo controlado por usuario requiere URL, parametro y evidencia para determinar si existe XSS; CSP no sustituye el escape de datos.

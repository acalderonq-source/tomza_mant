# Helmet

Helmet 8 se aplica globalmente mediante securityHeaders antes de recursos, rutas, sesiones y errores. La dependencia se fija en package-lock.json.

- Conserva X-Frame-Options SAMEORIGIN, MIME nosniff y Referrer-Policy same-origin.
- Agrega aislamiento de recursos del mismo origen, Origin-Agent-Cluster, bloqueo de politicas de plugins y X-XSS-Protection 0 para desactivar filtros antiguos.
- COOP same-origin-allow-popups conserva compatibilidad con autenticacion externa.
- HSTS de 180 dias solo si req.secure es verdadero, incluyendo HTTPS recibido por el proxy confiable de Render. No aplica a HTTP de localhost, ni incluye subdominios o preload.
- Mantiene la CSP anterior: frame-ancestors self, base-uri self, object-src none. No activa default-src ni restricciones nuevas para scripts, estilos, fuentes o imagenes: las vistas existentes usan scripts inline y CDN. No se afirma una CSP estricta contra XSS; se requiere migrar esos recursos antes de endurecerla.
- No activa COEP ni bloquea permisos de camara. CSRF, sesiones y permisos siguen siendo controles separados.
- Las rutas de adjuntos conservan su CSP sandbox especifica.

Pruebas HTTP en tests/helmet.test.js y pruebas de navegador del mapa y camara con el mismo middleware. Referencia: https://helmet.js.org/.

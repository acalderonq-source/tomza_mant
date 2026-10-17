function verificarEntorno(env = process.env) {
  if (env.APP_ENV !== 'staging') return;
  if (!env.STAGING_DATABASE_NAME || !env.PRODUCTION_DATABASE_NAME || env.MYSQLDATABASE !== env.STAGING_DATABASE_NAME || env.MYSQLDATABASE === env.PRODUCTION_DATABASE_NAME) {
    throw Error('Staging requiere una base separada identificada por STAGING_DATABASE_NAME.');
  }
  if (env.BACKUP_ENABLED === 'true') throw Error('No activar el respaldo de produccion en staging.');
  if (env.MAIL_ENABLED !== 'false') throw Error('Configure MAIL_ENABLED=false en staging.');
}
module.exports = { verificarEntorno };

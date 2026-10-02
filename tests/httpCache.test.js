const { test } = require("node:test");
const assert = require("node:assert/strict");
const { preventAuthenticatedHtmlCaching } = require("../src/utils/httpCache");

test("las paginas HTML autenticadas no se almacenan en caches compartidos o del navegador", () => {
  const headers = new Map();
  preventAuthenticatedHtmlCaching(
    { session: { user: { id: 10 } } },
    { setHeader: (name, value) => headers.set(name.toLowerCase(), value) }
  );

  assert.equal(headers.get("cache-control"), "private, no-store");
});

test("las paginas publicas no reciben politica privada de cache por autenticacion", () => {
  const headers = new Map();
  preventAuthenticatedHtmlCaching(
    { session: {} },
    { setHeader: (name, value) => headers.set(name.toLowerCase(), value) }
  );

  assert.equal(headers.has("cache-control"), false);
});

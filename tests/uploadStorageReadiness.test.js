const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BUNDLED_UPLOAD_ROOT, RENDER_UPLOAD_ROOT, resolverRaizUploads, verificarAlmacenamientoUploads } = require("../src/utils/uploadStorage");

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tomza-upload-readiness-"));
const writableDirectory = path.join(testRoot, "persistent");
fs.mkdirSync(writableDirectory);
const regularFile = path.join(testRoot, "not-a-directory");
fs.writeFileSync(regularFile, "test");

test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

test("readiness accepts a configured writable uploads directory in production", () => {
  assert.deepEqual(verificarAlmacenamientoUploads({
    root: writableDirectory,
    configuredRoot: writableDirectory,
    production: true
  }), { listo: true, motivo: null });
});

test("readiness rejects production when uploads fall back to bundled ephemeral storage", () => {
  const result = verificarAlmacenamientoUploads({
    root: writableDirectory,
    configuredRoot: BUNDLED_UPLOAD_ROOT,
    production: true
  });

  assert.equal(result.listo, false);
  assert.equal(result.motivo, "persistent_root_not_configured");
});

test("Render defaults uploads to the persistent mount declared in its service config", () => {
  assert.equal(resolverRaizUploads({ RENDER: "true" }), RENDER_UPLOAD_ROOT);
  assert.equal(resolverRaizUploads({ UPLOAD_ROOT: writableDirectory, RENDER: "true" }), writableDirectory);
});

test("readiness rejects missing or non-directory uploads paths", () => {
  assert.equal(verificarAlmacenamientoUploads({
    root: path.join(testRoot, "missing"), production: false
  }).listo, false);
  assert.deepEqual(verificarAlmacenamientoUploads({
    root: regularFile, production: false
  }), { listo: false, motivo: "not_a_directory" });
});

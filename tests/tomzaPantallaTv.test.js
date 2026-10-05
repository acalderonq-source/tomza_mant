const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = fs.readFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
const appUrl = fs.readFileSync(path.join(root, "android/app/src/main/res/values/strings.xml"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "src/views/taller_dashboard.ejs"), "utf8");

test("Tomza Pantalla is installable as an Android TV launcher app and opens Taller directly", () => {
  assert.match(manifest, /android\.software\.leanback/);
  assert.match(manifest, /android\.hardware\.touchscreen" android:required="false"/);
  assert.match(manifest, /android\.intent\.category\.LEANBACK_LAUNCHER/);
  assert.match(manifest, /android:banner="@drawable\/tv_banner"/);
  assert.match(appUrl, /login\?departamento=TALLER&amp;next=%2Ftaller%2Fdashboard/);
  assert.match(dashboard, /href="\/descargas\/TomzaPantalla\.apk\?v=2"/);
  assert.match(dashboard, /href="\/logout" class="btn btn-outline-light btn-sm flex-shrink-0"[\s\S]*Cerrar sesión/);
});

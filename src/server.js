require("dotenv").config();
require("./cronJobs");
const express = require("express");
const path = require("path");
const session = require("express-session");
const cron = require("node-cron");
const enviarAlertasDekra = require("./utils/dekraMail");
const { enviarRecordatoriosMantenimientos, ensurePushTables } = require("./utils/notificacionesPush");

// Inicializar app
const app = express();

// ===================== MIDDLEWARES =====================
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));
// ✅ CORREGIDO: Apunta a la carpeta public en la raíz del proyecto
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/.well-known/assetlinks.json", (req, res) => {
  const packageName = process.env.ANDROID_PACKAGE_NAME || "com.gastomza.taller";
  const fingerprints = String(process.env.ANDROID_SHA256_CERT_FINGERPRINT || "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);

  res.type("application/json");
  if (!fingerprints.length) {
    return res.json([]);
  }

  res.json([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: packageName,
      sha256_cert_fingerprints: fingerprints
    }
  }]);
});

// ===================== SESSION =====================
app.use(session({
  secret: "tomza_secret_key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true
  }
}));

// ===================== VISTAS =====================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ===================== PWA / APP INSTALABLE =====================
function injectPwaAssets(html) {
  if (typeof html !== "string") return html;

  let output = html;
  const pwaHead = `
  <meta name="theme-color" content="#111827">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Tomza Taller">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="icon" href="/img/app-icon.svg" type="image/svg+xml">`;
  const pwaScript = `\n<script src="/js/pwa.js" defer></script>`;

  if (!output.includes('href="/manifest.webmanifest"') && output.includes("</head>")) {
    output = output.replace("</head>", `${pwaHead}\n</head>`);
  }

  if (!output.includes('src="/js/pwa.js"') && output.includes("</body>")) {
    output = output.replace("</body>", `${pwaScript}\n</body>`);
  }

  return output;
}

app.use((req, res, next) => {
  const originalRender = res.render.bind(res);

  res.render = (view, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }

    originalRender(view, options, (err, html) => {
      if (callback) return callback(err, err ? html : injectPwaAssets(html));
      if (err) return next(err);
      res.send(injectPwaAssets(html));
    });
  };

  next();
});

// ===================== IMPORTAR RUTAS =====================
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const agendaRoutes = require("./routes/agenda.routes");
const mantenimientosRoutes = require("./routes/mantenimientos.routes");
const unidadesRoutes = require("./routes/unidades.routes");
const sedeRoutes = require("./routes/sede.routes");
const kpisRoutes = require("./routes/kpis.routes");
const aceiteRoutes = require("./routes/aceite.routes");
const airesRoutes = require("./routes/aires.routes");
const dekraRoutes = require("./routes/dekra.routes");
const minaeRoutes = require("./routes/minae.routes");
const comprasRoutes = require("./routes/compras.routes");
const llantasRoutes = require("./routes/llantas.routes");
const notificacionesRoutes = require("./routes/notificaciones.routes");
const iaRoutes = require("./routes/ia.routes");
const reportesSupervisoresRoutes = require("./routes/reportesSupervisores.routes");
const revisionRutaRoutes = require("./routes/revisionRuta.routes");
const girasRoutes = require("./routes/giras.routes");
const tallerRoutes = require("./routes/taller.routes");
const oficinaRoutes = require("./routes/oficina.routes");
const ordenesMotorRoutes = require("./routes/ordenesMotor.routes");

// ===================== USAR RUTAS =====================
app.use("/", authRoutes);
app.use("/", sedeRoutes);
app.use("/", adminRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/agenda", agendaRoutes);
app.use("/mantenimientos", mantenimientosRoutes);
app.use("/unidades", unidadesRoutes);
app.use("/kpis", kpisRoutes);
app.use("/aceite", aceiteRoutes);
app.use("/aires", airesRoutes);
app.use("/dekra", dekraRoutes);
app.use("/minae", minaeRoutes);
app.use("/compras", comprasRoutes);
app.use("/llantas", llantasRoutes);
app.use("/notificaciones", notificacionesRoutes);
app.use("/ia", iaRoutes);
app.use("/reportes-supervisores", reportesSupervisoresRoutes);
app.use("/revision-ruta", revisionRutaRoutes);
app.use("/giras", girasRoutes);
app.use("/taller", tallerRoutes);
app.use("/oficina-dia-dia", oficinaRoutes);
app.use("/ordenes-motor", ordenesMotorRoutes);

// ===================== CRON JOBS =====================
ensurePushTables().catch(error => {
  console.warn("No se pudo preparar tabla de notificaciones:", error.code || error.message);
});

cron.schedule("0 7 * * *", async () => {
  const hoy = new Date().getDate();
  if (hoy === 1 || hoy === 15) {
    console.log("📧 Enviando alertas DEKRA...");
    await enviarAlertasDekra();
  }
});

cron.schedule("0 8 * * *", async () => {
  try {
    console.log("🔔 Enviando recordatorios de mantenimientos de mañana...");
    const resultado = await enviarRecordatoriosMantenimientos();
    console.log("🔔 Resultado notificaciones:", resultado);
  } catch (error) {
    console.error("Error enviando notificaciones de mantenimientos:", error);
  }
});

// ===================== ROOT =====================
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log("ENTORNO:", process.env.NODE_ENV || "development");
  console.log("DB:", process.env.DB_NAME || "no definida");
});

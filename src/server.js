require("dotenv").config();
require("./cronJobs");
const express = require("express");
const path = require("path");
const session = require("express-session");
const cron = require("node-cron");
const enviarAlertasDekra = require("./utils/dekraMail");

// Inicializar app
const app = express();

// ===================== MIDDLEWARES =====================
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===================== SESSION =====================
app.use(session({
  secret: "tomza_secret_key",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // true solo si usas https
    httpOnly: true
  }
}));

// ===================== VISTAS =====================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

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
const dekraRoutes = require("./routes/dekra.routes");
const minaeRoutes = require("./routes/minae.routes");

// ===================== USAR RUTAS =====================
// Rutas base
app.use("/", authRoutes);
app.use("/", sedeRoutes);
app.use("/", adminRoutes);

// Módulos
app.use("/dashboard", dashboardRoutes);
app.use("/agenda", agendaRoutes);
app.use("/mantenimientos", mantenimientosRoutes);
app.use("/unidades", unidadesRoutes);
app.use("/kpis", kpisRoutes);
app.use("/aceite", aceiteRoutes);
app.use("/dekra", dekraRoutes);
app.use("/minae", minaeRoutes);

// ===================== CRON JOBS =====================
cron.schedule("0 7 * * *", async () => {
  const hoy = new Date().getDate();
  if (hoy === 1 || hoy === 15) {
    console.log("📧 Enviando alertas DEKRA...");
    await enviarAlertasDekra();
  }
});

// ===================== ROOT =====================
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.redirect("/dashboard");
});

// ===================== LOGOUT =====================
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ===================== SERVIDOR =====================
const PORT = process.env.PORT || 3000;

// Escuchar en todas las interfaces (necesario para Render)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log("ENTORNO:", process.env.NODE_ENV || "development");
  console.log("DB:", process.env.DB_NAME || "no definida");
});
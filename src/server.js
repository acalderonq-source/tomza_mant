require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
require('dotenv').config();
const cron = require("node-cron");
const enviarAlertasDekra = require("./utils/dekraMail");
const app = express();
const PORT = process.env.PORT || 3000;
const dekraRoutes = require("./routes/dekra.routes");
console.log("ENTORNO:", process.env.NODE_ENV);
console.log("DB:", process.env.DB_NAME);

// ===================== MIDDLEWARES =====================

// 🔥 IMPORTANTE: extended TRUE para que funcionen los arreglos (mecanicos[])
app.use(express.urlencoded({ extended: true }));

app.use(express.json());

// Static files
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
app.use("/dekra", dekraRoutes);
// ===================== VISTAS =====================
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
cron.schedule("0 7 * * *", async () => {

  const hoy = new Date().getDate();

  if (hoy === 1 || hoy === 15) {
    console.log("📧 Enviando alertas DEKRA...");
    await enviarAlertasDekra();
  }

});
// ===================== RUTAS =====================
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const agendaRoutes = require("./routes/agenda.routes");
const mantenimientosRoutes = require("./routes/mantenimientos.routes");
const unidadesRoutes = require("./routes/unidades.routes");
const sedeRoutes = require("./routes/sede.routes");
const kpisRoutes = require("./routes/kpis.routes");
const aceiteRoutes = require("./routes/aceite.routes");

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

// ===================== SERVER =====================
app.listen(PORT, () => {
  console.log("🚀 Servidor corriendo en puerto", PORT);
});
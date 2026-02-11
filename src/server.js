require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

console.log("ENTORNO:", process.env.NODE_ENV);
console.log("DB:", process.env.DB_NAME);

// ===================== MIDDLEWARES =====================
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Ajusta esta ruta si tu carpeta public está en src/public
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  secret: "tomza_secret_key",
  resave: false,
  saveUninitialized: false
}));

// ===================== VISTAS =====================
app.set("view engine", "ejs");
// Ajusta si tus vistas están en src/views
app.set("views", path.join(__dirname, "views"));

// ===================== RUTAS =====================
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const agendaRoutes = require("./routes/agenda.routes");
const mantenimientosRoutes = require("./routes/mantenimientos.routes");
const unidadesRoutes = require("./routes/unidades.routes");
const sedeRoutes = require("./routes/sede.routes");
const kpisRoutes = require("./routes/kpis.routes");

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
  console.log("Servidor corriendo en puerto", PORT);
});

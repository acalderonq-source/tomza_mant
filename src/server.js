require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");

const app = express();

/* ===============================
   CONFIGURACIÓN BÁSICA
   =============================== */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

/* ===============================
   ARCHIVOS ESTÁTICOS
   =============================== */
app.use(express.static(path.join(__dirname, "..", "public")));

/* ===============================
   SESIONES
   =============================== */
app.use(
  session({
    secret: process.env.SESSION_SECRET || "tomza_secret",
    resave: false,
    saveUninitialized: false
  })
);

/* ===============================
   VISTAS EJS
   =============================== */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* ===============================
   MIDDLEWARE GLOBAL DE USUARIO
   =============================== */
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

/* ===============================
   RUTAS
   =============================== */
const authRoutes = require("./routes/auth.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const agendaRoutes = require("./routes/agenda.routes");
const mantenimientosRoutes = require("./routes/mantenimientos.routes");

app.use(authRoutes);
app.use("/dashboard", dashboardRoutes);
app.use("/agenda", agendaRoutes);
app.use("/mantenimientos", mantenimientosRoutes);

/* ===============================
   RUTA SALUD (DEBUG)
   =============================== */
app.get("/health", (req, res) => {
  res.send("OK");
});

/* ===============================
   REDIRECCIONES
   =============================== */
app.get("/", (req, res) => {
  if (req.session.user) {
    res.redirect("/dashboard");
  } else {
    res.redirect("/login");
  }
});

/* ===============================
   MANEJO DE ERRORES 404
   =============================== */
app.use((req, res) => {
  res.status(404).send("Ruta no encontrada");
});

/* ===============================
   SERVIDOR
   =============================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});

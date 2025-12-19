require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);

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
   BASE DE DATOS
   =============================== */
const pool = require("./db");

/* ===============================
   SESIONES EN MYSQL (PRODUCCIÓN)
   =============================== */
const sessionStore = new MySQLStore(
  {
    clearExpired: true,
    checkExpirationInterval: 900000, // 15 min
    expiration: 1000 * 60 * 60 * 8   // 8 horas
  },
  pool
);

app.use(
  session({
    name: "tomza_session",
    secret: process.env.SESSION_SECRET || "tomza_secret",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Render usa proxy HTTPS
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

/* ===============================
   VISTAS EJS
   =============================== */
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

/* ===============================
   USUARIO GLOBAL PARA VISTAS
   =============================== */
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

/* ===============================
   MIDDLEWARE DE AUTENTICACIÓN
   =============================== */
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

/* ===============================
   RUTAS
   =============================== */
const authRoutes = require("./routes/auth.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const agendaRoutes = require("./routes/agenda.routes");
const mantenimientosRoutes = require("./routes/mantenimientos.routes");

/* ---------- AUTENTICACIÓN ---------- */
app.use(authRoutes);

/* ---------- DASHBOARD ---------- */
app.use("/dashboard", requireLogin, dashboardRoutes);

/* ---------- AGENDA ---------- */
app.use("/agenda", requireLogin, agendaRoutes);

/* ---------- MANTENIMIENTOS ---------- */
app.use("/mantenimientos", requireLogin, mantenimientosRoutes);

/* ===============================
   RUTA RAÍZ
   =============================== */
app.get("/", (req, res) => {
  if (req.session.user) {
    res.redirect("/dashboard");
  } else {
    res.redirect("/login");
  }
});

/* ===============================
   HEALTH CHECK (RENDER)
   =============================== */
app.get("/health", (req, res) => {
  res.send("OK");
});

/* ===============================
   404
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

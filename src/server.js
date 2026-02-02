require("dotenv").config();

const express = require("express");
const path = require("path");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;
console.log("ENTORNO:", process.env.NODE_ENV);
console.log("DB:", process.env.DB_NAME);

// middlewares
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

app.use(session({
  secret: "tomza_secret_key",
  resave: false,
  saveUninitialized: false
}));

// vistas
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
const adminRoutes = require("./routes/admin.routes");
app.use("/", adminRoutes);

// rutas
const authRoutes = require("./routes/auth.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const agendaRoutes = require("./routes/agenda.routes");
const mantenimientosRoutes = require("./routes/mantenimientos.routes");
const unidadesRoutes = require("./routes/unidades.routes");
const sedeRoutes = require("./routes/sede.routes"); // NUEVO

app.use("/", authRoutes);
app.use("/", sedeRoutes); 
app.use("/dashboard", dashboardRoutes);
app.use("/agenda", agendaRoutes);
app.use("/mantenimientos", mantenimientosRoutes);
app.use("/unidades", unidadesRoutes);

// raíz
app.get("/", (req, res) => {
  if (!req.session.user) return res.redirect("/login");
  res.redirect("/dashboard");
});

// logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});

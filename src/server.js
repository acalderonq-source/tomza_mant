require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const { requireAuth } = require("./middleware");

const authRoutes = require("./routes/auth.routes");
const dashboardRoutes = require("./routes/dashboard.routes");
const unidadesRoutes = require("./routes/unidades.routes");
const agendaRoutes = require("./routes/agenda.routes");
const mantenimientosRoutes = require("./routes/mantenimientos.routes");

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/public", express.static(path.join(__dirname,"..","public")));
app.use(express.static("public"));

app.set("view engine","ejs");
app.set("views", path.join(__dirname,"views"));

app.get("/", (req,res)=>res.redirect("/dashboard"));
app.use("/", authRoutes);

app.use(requireAuth);
app.use("/", dashboardRoutes);
app.use("/unidades", unidadesRoutes);
app.use("/agenda", agendaRoutes);
app.use("/mantenimientos", mantenimientosRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto", PORT);
});

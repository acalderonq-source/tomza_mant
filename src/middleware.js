const { verifyToken } = require("./auth");

function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) return res.redirect("/login");
    const user = verifyToken(token);
    req.user = user;
    res.locals.user = user;
    next();
  } catch {
    res.clearCookie("token");
    return res.redirect("/login");
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.redirect("/login");
    if (!roles.includes(req.user.rol)) return res.status(403).send("Sin permisos");
    next();
  };
}

module.exports = { requireAuth, requireRole };
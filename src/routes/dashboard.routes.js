const express = require("express");
const router = express.Router();

/**
 * DASHBOARD PRINCIPAL
 */
router.get("/", (req, res) => {
  if (!req.session.user) {
    return res.redirect("/login");
  }

  res.render("dashboard", {
    user: req.session.user
  });
});

module.exports = router;

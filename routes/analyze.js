const express = require("express");
const router = express.Router();
const { setReport } = require("../report/reportStore");
const { generateReport } = require("../ai/generateReport");

router.post("/analyze", async (req, res) => {
  const body = req.body;
  if (!body || Object.keys(body).length === 0) {
    return res.status(400).json({ error: "Request body must contain analytics report data" });
  }

  const normalized = body.normalized;
  const flags = body.flags || [];
  const crawlerRan = body.crawlerRan || false;
  const rawMode = body.mode || req.query.mode;
  const mode = rawMode === "quick" ? "quick" : "comprehensive";
  const mockMode = req.query.mock === "true" || body.mock === true;
  const storeId = body.storeId || req.query.storeId;

  if (!normalized) {
    return res.status(400).json({ error: "Request body must include 'normalized' analytics data" });
  }

  try {
    const result = await generateReport({ normalized, flags, crawlerRan, mode, mockMode });
    if (storeId) setReport(storeId, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `AI analysis failed: ${err.message}` });
  }
});

module.exports = router;

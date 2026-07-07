const express = require("express");
const router = express.Router();
const { getReport, setReport } = require("../report/reportStore");
const { generateReport } = require("../ai/generateReport");

const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || "http://localhost:4000";

// Full view, includes `analysis` (issue/recommendation/codePatch) for devs.
router.get("/report", (req, res) => {
  const { storeId } = req.query;
  if (!storeId) {
    return res.status(400).json({ error: "storeId is required" });
  }

  const saved = getReport(storeId);
  if (!saved) {
    return res.status(404).json({ error: "No report found for this storeId" });
  }

  res.json(saved);
});

// PM view: same report, but with `analysis` (which carries codePatch) stripped out.
router.get("/report/pm", (req, res) => {
  const { storeId } = req.query;
  if (!storeId) {
    return res.status(400).json({ error: "storeId is required" });
  }

  const saved = getReport(storeId);
  if (!saved) {
    return res.status(404).json({ error: "No report found for this storeId" });
  }

  const { analysis, ...pmView } = saved;
  res.json(pmView);
});

// Pulls normalized analytics for storeId from the Analytics Service, then
// runs it through the AI report pipeline and caches the result.
router.post("/report/generate", async (req, res) => {
  const storeId = (req.body && req.body.storeId) || req.query.storeId;
  if (!storeId) {
    return res.status(400).json({ error: "storeId is required" });
  }

  const rawMode = (req.body && req.body.mode) || req.query.mode;
  const mode = rawMode === "quick" ? "quick" : "comprehensive";
  const mockMode = req.query.mock === "true" || (req.body && req.body.mock === true);

  let analyticsData;
  try {
    const url = `${ANALYTICS_SERVICE_URL}/api/analytics/report?storeId=${encodeURIComponent(storeId)}`;
    const response = await fetch(url);
    if (!response.ok) {
      return res.status(502).json({ error: `Analytics service returned ${response.status}` });
    }
    analyticsData = await response.json();
  } catch (err) {
    return res.status(502).json({ error: `Failed to reach analytics service: ${err.message}` });
  }

  const { normalized, flags, crawlerRan } = analyticsData;
  if (!normalized) {
    return res.status(502).json({ error: "Analytics service returned no normalized data" });
  }

  try {
    const result = await generateReport({
      normalized,
      flags: flags || [],
      crawlerRan: crawlerRan || false,
      mode,
      mockMode,
    });
    setReport(storeId, result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `AI analysis failed: ${err.message}` });
  }
});

module.exports = router;

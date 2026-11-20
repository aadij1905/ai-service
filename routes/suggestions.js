const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

// Append-only log of PO decisions (with the full suggestion when the client
// sends it): the labelled dataset for eval/ and finetune/.
const DECISIONS_FILE = path.join(__dirname, "..", "data", "decisions.jsonl");

// In-memory store: { [storeId]: { [suggestionId]: { action, title, respondedAt } } }
const responses = {};

router.post("/suggestions/respond", (req, res) => {
  const { storeId, suggestionId, action, title, item } = req.body;

  if (!storeId || !suggestionId || !action) {
    return res.status(400).json({ error: "storeId, suggestionId, and action are required" });
  }
  if (!["accept", "reject"].includes(action)) {
    return res.status(400).json({ error: "action must be 'accept' or 'reject'" });
  }

  if (!responses[storeId]) responses[storeId] = {};
  responses[storeId][suggestionId] = {
    action,
    title: title || null,
    respondedAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(DECISIONS_FILE), { recursive: true });
  fs.appendFileSync(DECISIONS_FILE, JSON.stringify({ storeId, suggestionId, action, item: item || { title }, respondedAt: responses[storeId][suggestionId].respondedAt }) + "\n");

  res.json({
    success: true,
    storeId,
    suggestionId,
    action,
    respondedAt: responses[storeId][suggestionId].respondedAt,
  });
});

router.get("/suggestions/status", (req, res) => {
  const { storeId } = req.query;
  if (!storeId) {
    return res.status(400).json({ error: "storeId is required" });
  }

  const storeResponses = responses[storeId] || {};
  const list = Object.entries(storeResponses).map(([suggestionId, data]) => ({
    suggestionId,
    ...data,
  }));

  res.json({
    storeId,
    total: list.length,
    accepted: list.filter((s) => s.action === "accept").length,
    rejected: list.filter((s) => s.action === "reject").length,
    suggestions: list,
  });
});

// Clear all responses for a store (called after a new sync)
router.delete("/suggestions/status", (req, res) => {
  const { storeId } = req.query;
  if (!storeId) return res.status(400).json({ error: "storeId is required" });
  delete responses[storeId];
  res.json({ success: true, storeId, message: "Suggestion responses cleared" });
});

module.exports = router;

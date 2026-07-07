const express = require("express");
const router = express.Router();
const { getCaller } = require("../ai/llm");
const { buildCodePrompt } = require("../ai/codePrompt");

// Full-code generation uses its own model (Gemini by default — strong at code),
// independent of AI_PROVIDER which drives suggestion generation.
const CODE_PROVIDER = process.env.CODE_PROVIDER || "gemini";

// POST /code/generate — full, focused code patch for a single suggestion.
// Body: { item: { title, category, affectedPage, issue, recommendation, codePatch, ... } }
router.post("/code/generate", async (req, res) => {
  const item = req.body && req.body.item;
  if (!item || !item.title) {
    return res.status(400).json({ error: "item (with at least a title) is required" });
  }

  try {
    console.log(`[code/generate] provider=${CODE_PROVIDER} item="${item.title}"`);
    const { content, meta } = await getCaller(CODE_PROVIDER)(buildCodePrompt(item), 8000);
    const codePatch = {
      type: content.type || "manual",
      file: content.file || item.affectedPage || null,
      code: content.code || null,
      instructions: content.instructions || null,
      notes: content.notes || null,
    };
    res.json({ codePatch, meta });
  } catch (err) {
    res.status(500).json({ error: `Code generation failed: ${err.message}` });
  }
});

module.exports = router;

// ai/judgePrompt.js
// Prompt for the "judge" step of orchestration. Multiple generator models each
// draft candidate suggestions; the judge merges duplicates, drops weak/
// hallucinated ones, re-ranks, and returns the best set in the exact schema.

function buildJudgePrompt(reportData, candidates, mode) {
  const target = mode === "quick" ? "exactly 3" : "between 20 and 25";

  return `You are a senior Shopify CRO lead reviewing candidate findings drafted by
several AI analysts. Some overlap, some are weak, some may cite numbers that
aren't in the data. Your job is to produce the FINAL, best set.

SELECT AND REFINE ${target} distinct suggestions:
1. MERGE duplicates / near-duplicates (same issue on the same page/area) into one,
   keeping the strongest wording and the best code patch.
2. DROP anything that: cites numbers not supported by the DATA below, is vague,
   lacks a concrete action, or has no clear data source.
3. Ensure EVERY item fully populates all fields for BOTH audiences (problem +
   suggestion for owners; issue + recommendation + codePatch for developers).
4. RE-RANK by (severity × confidence × data quality); set "rank" 1..N and set
   "confidence" honestly ("high" only if directly supported by real numbers).
5. Prefer suggestions that multiple analysts independently raised.
6. Keep the EXACT same JSON schema as the candidates.

=== DATA (ground truth — the only numbers you may cite) ===
${JSON.stringify(reportData, null, 2)}

=== CANDIDATE SUGGESTIONS (from multiple models, may overlap) ===
${JSON.stringify(candidates, null, 2)}

Return ONLY valid JSON, no markdown, no prose:
{
  "items": [
    {
      "id": "string",
      "rank": 1,
      "category": "conversion|traffic|mobile|performance|content|trust|funnel",
      "title": "string",
      "problem": "plain-English for a non-technical owner, cite real numbers",
      "suggestion": "one plain-English action, no jargon",
      "issue": "technical version for a developer, cite real numbers",
      "recommendation": "specific technical action",
      "affectedPage": "string",
      "impactEstimate": "string",
      "effort": "low|medium|high",
      "confidence": "high|medium|low",
      "dataSource": "which fields",
      "codePatch": { "type": "liquid|css|manual", "code": "string or null", "file": "string or null", "instructions": "string or null" }
    }
  ]
}`;
}

module.exports = { buildJudgePrompt };

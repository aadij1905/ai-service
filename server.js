require("dotenv").config();
const express = require("express");
const cors = require("cors");
const analyzeRouter = require("./routes/analyze");
const suggestionsRouter = require("./routes/suggestions");
const reportRouter = require("./routes/report");
const codeRouter = require("./routes/code");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "ai-service",
    version: "2.0.0",
    model: "llama-3.3-70b-versatile (via Groq)",
    apiKeyConfigured: Boolean(process.env.GROQ_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

app.use("/", analyzeRouter);
app.use("/", suggestionsRouter);
app.use("/", reportRouter);
app.use("/", codeRouter);

app.listen(PORT, () => {
  console.log(`AI service listening on port ${PORT}`);
});

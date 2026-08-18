// ai/smokeTest.js
// Shared standalone smoke test for provider clients: node ai/<provider>Client.js
function smokeTest(callFn, label) {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file (e.g. env vars injected directly, as on Railway) — fine
  }

  callFn(`Return ONLY valid JSON matching: { "status": "ok" }`, 100)
    .then(({ content, meta }) => {
      console.log("Parsed content:", content);
      console.log("Meta:", meta);
    })
    .catch((err) => {
      console.error(`${label} test failed:`, err.message);
      process.exitCode = 1;
    });
}

module.exports = { smokeTest };

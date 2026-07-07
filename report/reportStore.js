// report/reportStore.js
// In-memory store: { [storeId]: { report, analysis, meta, savedAt } }
const reports = {};

function setReport(storeId, data) {
  reports[storeId] = { ...data, savedAt: new Date().toISOString() };
}

function getReport(storeId) {
  return reports[storeId] || null;
}

module.exports = { setReport, getReport };

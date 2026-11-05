const { analyzeWorkbook, summarizeAnalysis, previewRows, importWorkbook } = require('../services/assetImportService');

// Options for updating items already in the register: update_existing, fill_only ('false' to also replace values
// that differ) and groups (comma separated: value, location, condition, officer, details)
const updateOptions = (body = {}) => ({
  updateExisting: body.update_existing === 'true',
  fillOnly: body.fill_only !== 'false',
  groups: body.groups ? String(body.groups).split(',').map((g) => g.trim()).filter(Boolean) : null,
});

const fail = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

// POST /api/assets/import/preview   (multipart: file)
// Reads the asset registers workbook and reports what an import would do. Nothing is created.
const previewAssetImport = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose the asset registers workbook (.xlsx)' });
    const analysis = await analyzeWorkbook(req.file.buffer, updateOptions(req.body));
    res.json({ summary: summarizeAnalysis(analysis), ...previewRows(analysis) });
  } catch (err) {
    fail(res, err, 'Could not check the workbook');
  }
};

// POST /api/assets/import   (multipart: file, include_stock?)
// Items already in the register (same tag) are skipped, so running it again is safe.
const importAssets = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose the asset registers workbook (.xlsx)' });
    const analysis = await analyzeWorkbook(req.file.buffer, updateOptions(req.body));
    const summary = summarizeAnalysis(analysis);
    if (summary.assets.ready === 0 && summary.stock.ready === 0 && !summary.updates?.to_change) {
      return res.status(400).json({ error: 'Everything in this workbook is already in the system.', summary });
    }
    const result = await importWorkbook(analysis, { includeStock: req.body?.include_stock !== 'false', userId: req.user.id });
    const parts = [
      result.assets_created ? `Added ${result.assets_created} assets` : '',
      result.assets_updated ? `updated ${result.assets_updated} existing assets` : '',
      result.stock_created ? `added ${result.stock_created} stock items` : '',
    ].filter(Boolean).join(', ');
    res.json({ message: parts ? parts.charAt(0).toUpperCase() + parts.slice(1) : 'Nothing to change', summary, ...result });
  } catch (err) {
    fail(res, err, 'Import failed');
  }
};

module.exports = { previewAssetImport, importAssets };

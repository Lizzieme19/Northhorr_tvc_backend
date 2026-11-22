const svc = require('../services/admissionRestoreService');

const meta = (req) => ({ userId: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] });
const send = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.preview ? { preview: err.preview } : {}) });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};
const ids = (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : Array.isArray(v) ? v : undefined);

// GET /api/student-merges - every earlier merge, and whether it can be restored
const list = async (req, res) => {
  try { res.json({ merges: await svc.listPastMerges() }); }
  catch (err) { send(res, err, 'Could not load the earlier merges'); }
};

// GET /api/student-merges/:id/preview?term_ids=a,b&status=GRADUATED - what restoring would do. Changes nothing.
const preview = async (req, res) => {
  try { res.json(await svc.previewRestore(req.params.id, { termIds: ids(req.query.term_ids), status: req.query.status })); }
  catch (err) { send(res, err, 'Could not work out the restore'); }
};

// POST /api/student-merges/:id/restore { term_ids?, status?, acknowledge_warnings }
const restore = async (req, res) => {
  try {
    const b = req.body || {};
    const r = await svc.applyRestore(req.params.id, meta(req), { termIds: ids(b.term_ids), status: b.status, acknowledge: b.acknowledge_warnings === true });
    res.json({ message: `${r.restored} is back as its own admission, linked under ${r.linked_under}. ${r.terms_moved} term bill(s) and ${r.payments_moved} payment(s) moved with it.`, ...r });
  } catch (err) { send(res, err, 'Could not restore the admission'); }
};

module.exports = { list, preview, restore };

const prisma = require('../config/db');
const docs = require('../services/documentService');
const { buildReport, catalogFor } = require('../services/reportBuilders');
const { renderPdf, renderXlsx } = require('../services/reportRender');

const send = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};
const stampDay = () => new Date().toISOString().slice(0, 10);
const safeName = (id, report) => `${report?.file_base || id}_${stampDay()}`;

// GET /api/reports/catalog - the reports this person may run, and the filters each one understands
const catalog = async (req, res) => {
  try { res.json({ reports: catalogFor(req.user.role) }); }
  catch (err) { send(res, err, 'Could not load the reports'); }
};

// GET /api/reports/:id/preview?<filters> - the report as it will print, with the college letterhead details.
// Long reports are cut short on screen; the PDF and Excel files carry every row.
const preview = async (req, res) => {
  try {
    const [report, letterhead] = await Promise.all([buildReport(req.params.id, req.query, { role: req.user.role }), docs.loadStyle()]);
    res.json({ report, letterhead, generated_at: new Date().toISOString(), generated_by: req.user.email });
  } catch (err) { send(res, err, 'Could not build the report'); }
};

// GET /api/reports/:id/pdf?<filters>
const pdf = async (req, res) => {
  try {
    const report = await buildReport(req.params.id, req.query, { role: req.user.role, full: true });
    const buffer = await renderPdf(report, { generatedBy: req.user.email });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${safeName(req.params.id, report)}.pdf"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  } catch (err) { send(res, err, 'Could not make the PDF'); }
};

// GET /api/reports/:id/xlsx?<filters>
const xlsx = async (req, res) => {
  try {
    const [report, style] = await Promise.all([buildReport(req.params.id, req.query, { role: req.user.role, full: true }), docs.loadStyle()]);
    const buffer = renderXlsx(report, { generatedBy: req.user.email, style });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName(req.params.id, report)}.xlsx"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  } catch (err) { send(res, err, 'Could not make the Excel file'); }
};

// GET /api/reports/my-statement/pdf - a student's own fee statement (their records only, no staff details)
const myStatementPdf = async (req, res) => {
  try {
    const own = await prisma.student.findUnique({ where: { user_id: req.user.id }, select: { id: true } });
    if (!own) return res.status(404).json({ error: 'Student profile not found' });
    const report = await buildReport('student-statement', { student_id: own.id }, { role: 'ADMIN', full: true, audience: 'student' });
    const buffer = await renderPdf(report, { generatedBy: '' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${safeName('fee-statement', report)}.pdf"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  } catch (err) { send(res, err, 'Could not make your statement'); }
};

module.exports = { catalog, preview, pdf, xlsx, myStatementPdf };

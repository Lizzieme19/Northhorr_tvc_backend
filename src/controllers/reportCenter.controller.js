const prisma = require('../config/db');
const docs = require('../services/documentService');
const { buildReport, catalogFor, scopeFor, APP_STATUSES, REQ_STATUSES } = require('../services/reportBuilders');
const { STUDENT_STATUSES, INTAKES, BALANCE_STATUSES } = require('../utils/studentFilters');
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
  try { res.json({ reports: catalogFor(req.user.role), scope: await scopeFor(req.user.role, req.user.id) }); }
  catch (err) { send(res, err, 'Could not load the reports'); }
};

// GET /api/reports/filters - the choices for the filter boxes, limited to what this person may see.
// A department head gets their own department and its courses only; fee choices are for Admin and Finance.
const filters = async (req, res) => {
  try {
    const role = req.user.role;
    const scope = await scopeFor(role, req.user.id);
    const money = ['ADMIN', 'FINANCE'].includes(role);
    const studentWhere = scope ? { department_id: scope.department_id } : {};
    const [levels, years, departments, courses, terms, feeTypes, studentTypes] = await Promise.all([
      prisma.student.findMany({ where: studentWhere, distinct: ['level'], select: { level: true }, orderBy: { level: 'asc' } }),
      prisma.student.findMany({ where: studentWhere, distinct: ['year'], select: { year: true }, orderBy: { year: 'desc' } }),
      prisma.department.findMany({ where: scope ? { id: scope.department_id } : {}, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.course.findMany({ where: scope ? { department_id: scope.department_id } : {}, select: { id: true, name: true, department_id: true }, orderBy: { name: 'asc' } }),
      prisma.term.findMany({ select: { id: true, name: true, academic_year: true, intake: true, start_date: true, end_date: true, term_cost: true, is_active: true }, orderBy: { start_date: 'desc' } }),
      money ? prisma.feeType.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
      prisma.studentType.findMany({ where: { is_active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    res.json({
      scope, levels: levels.map((l) => l.level).filter(Boolean), years: years.map((y) => y.year), intakes: INTAKES,
      student_statuses: STUDENT_STATUSES, fee_statuses: money ? BALANCE_STATUSES : [], application_statuses: APP_STATUSES, requisition_statuses: REQ_STATUSES,
      departments, courses, terms, fee_types: feeTypes, student_types: studentTypes,
    });
  } catch (err) { send(res, err, 'Could not load the filter choices'); }
};

// GET /api/reports/:id/preview?<filters> - the report as it will print, with the college letterhead details.
// Long reports are cut short on screen; the PDF and Excel files carry every row.
const preview = async (req, res) => {
  try {
    const [report, letterhead] = await Promise.all([buildReport(req.params.id, req.query, { role: req.user.role, userId: req.user.id }), docs.loadStyle()]);
    res.json({ report, letterhead, generated_at: new Date().toISOString(), generated_by: req.user.email });
  } catch (err) { send(res, err, 'Could not build the report'); }
};

// GET /api/reports/:id/pdf?<filters>
const pdf = async (req, res) => {
  try {
    const report = await buildReport(req.params.id, req.query, { role: req.user.role, userId: req.user.id, full: true });
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
    const [report, style] = await Promise.all([buildReport(req.params.id, req.query, { role: req.user.role, userId: req.user.id, full: true }), docs.loadStyle()]);
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

module.exports = { catalog, filters, preview, pdf, xlsx, myStatementPdf };

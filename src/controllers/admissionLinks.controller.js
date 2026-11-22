const prisma = require('../config/db');
const svc = require('../services/admissionLinkService');

const meta = (req) => ({ userId: req.user.id, ip: req.ip, userAgent: req.headers['user-agent'] });
const send = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.preview ? { preview: err.preview } : {}) });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

// GET /api/students/:id/link-preview?other=<student id>
// Both admissions side by side, what differs, overlapping bills, and whether linking is allowed. Changes nothing.
const previewLink = async (req, res) => {
  try {
    // the registrar sees who the student is, not the money
    res.json(await svc.previewLink(req.params.id, req.query.other, { withMoney: req.user.role !== 'REGISTRAR' }));
  } catch (err) { send(res, err, 'Could not compare the admissions'); }
};

// POST /api/students/:id/link-admission { linked_student_id, acknowledge_warnings }
// :id keeps the login; the other admission is linked under it. Nothing is moved or deleted.
const linkAdmission = async (req, res) => {
  try {
    const { linked_student_id, acknowledge_warnings } = req.body || {};
    const r = await svc.linkAdmissions(req.params.id, linked_student_id, meta(req), { acknowledge: acknowledge_warnings === true });
    res.json({ message: `${r.linked} is now linked to ${r.primary}. They share one login (${r.primary}); each admission keeps its own bills, payments and documents.`, ...r });
  } catch (err) { send(res, err, 'Could not link the admissions'); }
};

// POST /api/students/:id/unlink-admission   (:id is the linked admission)
const unlinkAdmission = async (req, res) => {
  try {
    const r = await svc.unlinkAdmission(req.params.id, meta(req));
    res.json({ message: `${r.admission_no} is no longer linked. It has its own login again, with the password it had before.`, ...r });
  } catch (err) { send(res, err, 'Could not unlink the admission'); }
};

// GET /api/students/:id/statement - every admission's bills and payments, and the total across them
const getStatement = async (req, res) => {
  try { res.json(await svc.statementFor(req.params.id)); }
  catch (err) { send(res, err, 'Could not load the statement'); }
};

// GET /api/students/me/statement - the signed-in student's own statement across their admissions
const getMyStatement = async (req, res) => {
  try {
    const own = await prisma.student.findUnique({ where: { user_id: req.user.id }, select: { id: true } });
    if (!own) return res.status(404).json({ error: 'Student profile not found' });
    res.json(await svc.statementFor(own.id));
  } catch (err) { send(res, err, 'Could not load your statement'); }
};

module.exports = { previewLink, linkAdmission, unlinkAdmission, getStatement, getMyStatement };

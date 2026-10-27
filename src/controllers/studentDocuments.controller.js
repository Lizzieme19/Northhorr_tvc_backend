const prisma = require('../config/db');
const {
  STUDENT_DOCUMENTS,
  SLUGS,
  loadStudentForDocuments,
  findIssued,
  issueDocument,
  listForStudent,
  readStoredFile,
  downloadFileName,
} = require('../services/studentDocumentService');

const MAX_BULK_STUDENTS = 200;

// "all" or a list of slugs -> validated list of slugs
const resolveSlugs = (documents) => {
  if (!documents || documents === 'all') return SLUGS;
  const list = Array.isArray(documents) ? documents : [documents];
  const invalid = list.filter((d) => !SLUGS.includes(d));
  if (invalid.length) throw Object.assign(new Error(`Unknown document(s): ${invalid.join(', ')}`), { status: 400 });
  return list;
};

// GET /api/student-documents/me  (student)
const getMyDocuments = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({ where: { user_id: req.user.id }, select: { id: true } });
    if (!student) return res.status(404).json({ error: 'Student profile not found' });
    res.json({ student_id: student.id, documents: await listForStudent(student.id) });
  } catch (err) {
    console.error('Get my documents error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/student-documents/:studentId  (admin, registrar)
const getStudentDocuments = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({ where: { id: req.params.studentId }, select: { id: true } });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    res.json({ student_id: student.id, documents: await listForStudent(student.id) });
  } catch (err) {
    console.error('Get student documents error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/student-documents/:studentId/issue  (admin, registrar)
// body: { documents: 'all' | ['admission-letter', ...], regenerate?: boolean }
const issueStudentDocuments = async (req, res) => {
  try {
    const slugs = resolveSlugs(req.body?.documents);
    const regenerate = req.body?.regenerate === true;

    const student = await loadStudentForDocuments({ id: req.params.studentId });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const results = [];
    for (const slug of slugs) {
      try {
        const { created } = await issueDocument(student, slug, req.user.id, { regenerate });
        results.push({ slug, label: STUDENT_DOCUMENTS[slug].label, status: created ? (regenerate ? 'regenerated' : 'issued') : 'already_issued' });
      } catch (err) {
        console.error(`Issue ${slug} failed for ${student.admission_no}:`, err);
        results.push({ slug, label: STUDENT_DOCUMENTS[slug].label, status: 'failed', error: 'Could not generate this document' });
      }
    }

    const failed = results.filter((r) => r.status === 'failed').length;
    res.status(failed === results.length ? 500 : 200).json({
      message: failed ? 'Some documents could not be generated' : 'Documents issued successfully',
      results,
      documents: await listForStudent(student.id),
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Issue documents error:', err);
    res.status(500).json({ error: 'Failed to issue documents' });
  }
};

// POST /api/student-documents/bulk-issue  (admin, registrar)
// body: { student_ids: [], documents: 'all' | [...], regenerate?: boolean }
const bulkIssueDocuments = async (req, res) => {
  try {
    const { student_ids } = req.body || {};
    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({ error: 'student_ids is required' });
    }
    if (student_ids.length > MAX_BULK_STUDENTS) {
      return res.status(400).json({ error: `Select at most ${MAX_BULK_STUDENTS} students at a time` });
    }
    const slugs = resolveSlugs(req.body.documents);
    const regenerate = req.body.regenerate === true;

    const summary = { issued: 0, already_issued: 0, failed: 0, failures: [] };
    // One at a time: PDF generation is memory-heavy
    for (const id of student_ids) {
      const student = await loadStudentForDocuments({ id });
      if (!student) { summary.failed += slugs.length; summary.failures.push({ student_id: id, error: 'Student not found' }); continue; }
      for (const slug of slugs) {
        try {
          const { created } = await issueDocument(student, slug, req.user.id, { regenerate });
          if (created) summary.issued += 1; else summary.already_issued += 1;
        } catch (err) {
          console.error(`Bulk issue ${slug} failed for ${student.admission_no}:`, err);
          summary.failed += 1;
          summary.failures.push({ student_id: id, admission_no: student.admission_no, document: slug, error: 'Could not generate' });
        }
      }
    }
    res.json({ message: 'Bulk issue complete', ...summary });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Bulk issue error:', err);
    res.status(500).json({ error: 'Failed to issue documents' });
  }
};

// GET /api/student-documents/:studentId/:slug/download  (owner student, admin, registrar)
const downloadStudentDocument = async (req, res) => {
  try {
    const { studentId, slug } = req.params;
    if (!SLUGS.includes(slug)) return res.status(404).json({ error: 'Unknown document' });

    const student = await prisma.student.findUnique({ where: { id: studentId }, select: { id: true, user_id: true, admission_no: true } });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Students can only download their own documents
    if (req.user.role === 'STUDENT' && student.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const issued = await findIssued(student.id, slug);
    if (!issued) {
      return res.status(404).json({ error: `Your ${STUDENT_DOCUMENTS[slug].label} has not been issued yet. Please check back later or contact the college.` });
    }

    const buffer = await readStoredFile(issued);
    res.setHeader('Content-Type', 'application/pdf');
    // Private per-student file: no caching, so the browser never answers with an empty 304
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName(student, slug)}"`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  } catch (err) {
    console.error('Download document error:', err);
    res.status(500).json({ error: 'Failed to download document' });
  }
};

module.exports = { getMyDocuments, getStudentDocuments, issueStudentDocuments, bulkIssueDocuments, downloadStudentDocument };

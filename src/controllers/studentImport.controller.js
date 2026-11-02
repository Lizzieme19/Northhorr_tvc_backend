const prisma = require('../config/db');
const { readStudentSheet, buildTemplate } = require('../utils/spreadsheet');
const { analyzeRows, summarize, publicRows, importRows } = require('../services/studentImportService');

// Reads and checks the uploaded file. Shared by the preview and the import so both see the same result.
const analyzeUpload = async (req) => {
  if (!req.file) throw Object.assign(new Error('Choose a CSV, XLS or XLSX file to import'), { status: 400 });
  const { rows, ignored } = readStudentSheet(req.file.buffer, req.file.originalname);
  const analyzed = await analyzeRows(rows, { allowSimilar: req.body?.allow_similar === 'true' });
  return { analyzed, ignored };
};

const fail = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error(fallback, err);
  return res.status(500).json({ error: fallback });
};

// POST /api/students/import/preview   (multipart: file, allow_similar?)
// Checks the file and reports what would happen. Nothing is created.
const previewStudentImport = async (req, res) => {
  try {
    const { analyzed, ignored } = await analyzeUpload(req);
    res.json({ summary: summarize(analyzed), ignored_columns: ignored, rows: publicRows(analyzed) });
  } catch (err) {
    fail(res, err, 'Could not check the file');
  }
};

// POST /api/students/import   (multipart: file, allow_similar?)
// Creates every row that passed the check. Rows with problems are skipped and reported.
const importStudents = async (req, res) => {
  try {
    const { analyzed } = await analyzeUpload(req);
    const checked = summarize(analyzed);
    if (checked.ready === 0) {
      return res.status(400).json({ error: 'No rows are ready to import. Check the file and try again.', summary: checked, rows: publicRows(analyzed) });
    }
    const result = await importRows(analyzed, req.user.id);
    res.json({
      message: `Imported ${result.created} student${result.created === 1 ? '' : 's'}`,
      summary: { ...checked, created: result.created, failed: result.failed, skipped: checked.total - checked.ready },
      errors: result.errors,
      // Temporary passwords: shown once, so the college can hand them out
      credentials: result.credentials,
      skipped_rows: publicRows(analyzed.filter((r) => r.status !== 'ready')),
    });
  } catch (err) {
    fail(res, err, 'Import failed');
  }
};

// GET /api/students/import/template
const downloadImportTemplate = async (req, res) => {
  try {
    const [courses, terms] = await Promise.all([
      prisma.course.findMany({ select: { name: true, shortcode: true }, orderBy: { name: 'asc' } }),
      prisma.term.findMany({ select: { name: true, academic_year: true }, orderBy: { start_date: 'desc' } }),
    ]);
    const buffer = buildTemplate(courses, terms);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Student_Import_Template.xlsx"');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  } catch (err) {
    fail(res, err, 'Could not create the template');
  }
};

module.exports = { previewStudentImport, importStudents, downloadImportTemplate };

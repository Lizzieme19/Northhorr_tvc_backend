const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const c = require('../controllers/reportCenter.controller');

// Each report checks the person's role itself: fee reports are for Admin and Finance, applications for Admin, Registrar
// and department heads, requisitions for Admin, Procurement and department heads. A department head only ever gets
// their own department.
const who = requireRoles('ADMIN', 'FINANCE', 'REGISTRAR', 'DEPT_HEAD', 'PROCUREMENT');

/**
 * @swagger
 * /api/reports/catalog:
 *   get:
 *     summary: The reports this person may run, with the filters and options each one understands
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: The reports
 */
router.get('/catalog', authenticate, who, c.catalog);

/**
 * @swagger
 * /api/reports/filters:
 *   get:
 *     summary: Choices for the report filter boxes, limited to what this person may see
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Departments, courses, terms, levels, statuses and more
 */
router.get('/filters', authenticate, who, c.filters);

/**
 * @swagger
 * /api/reports/my-statement/pdf:
 *   get:
 *     summary: The signed-in student's own fee statement as a PDF on the college letterhead
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: A PDF
 */
router.get('/my-statement/pdf', authenticate, requireRoles('STUDENT'), c.myStatementPdf);

/**
 * @swagger
 * /api/reports/{id}/preview:
 *   get:
 *     summary: Build a report and return it for viewing on screen, before downloading
 *     description: Ids - fee-balances, fee-collections, fee-summary, student-statement, student-register, applications, requisitions. Query takes the filters the report lists in the catalog, plus group_by and sort.
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: The report and the letterhead details
 */
router.get('/:id/preview', authenticate, who, c.preview);

/**
 * @swagger
 * /api/reports/{id}/pdf:
 *   get:
 *     summary: The report as a PDF on the college letterhead (all rows)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: query, name: inline, schema: { type: string, enum: ['1'] }, description: Open in the browser instead of downloading }
 *     responses:
 *       200:
 *         description: A PDF
 */
router.get('/:id/pdf', authenticate, who, c.pdf);

/**
 * @swagger
 * /api/reports/{id}/xlsx:
 *   get:
 *     summary: The report as an Excel file - a laid-out Report sheet, and a Data sheet with the same rows for filtering
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: An Excel workbook
 */
router.get('/:id/xlsx', authenticate, who, c.xlsx);

module.exports = router;

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { requirePasswordChange } = require('../middleware/requirePasswordChange');
const {
  getMyDocuments,
  getStudentDocuments,
  issueStudentDocuments,
  bulkIssueDocuments,
  downloadStudentDocument,
} = require('../controllers/studentDocuments.controller');

/**
 * @swagger
 * /api/student-documents/me:
 *   get:
 *     summary: Which documents the college has issued to me (Student)
 *     tags: [Student Documents]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Admission Letter, Letter of Acceptance, Admission for Training and Personal Information, each with an issued flag
 */
router.get('/me', authenticate, requireRoles('STUDENT'), requirePasswordChange, getMyDocuments);

/**
 * @swagger
 * /api/student-documents/bulk-issue:
 *   post:
 *     summary: Issue documents to several students at once (Admin/Registrar)
 *     tags: [Student Documents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               student_ids: { type: array, items: { type: string } }
 *               documents: { description: "'all' or a list of slugs" }
 *               regenerate: { type: boolean }
 *     responses:
 *       200:
 *         description: Issue summary
 */
router.post('/bulk-issue', authenticate, requireRoles('ADMIN', 'REGISTRAR'), bulkIssueDocuments);

/**
 * @swagger
 * /api/student-documents/{studentId}:
 *   get:
 *     summary: Issued status of a student's documents (Admin/Registrar)
 *     tags: [Student Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Document list with issued flags
 */
router.get('/:studentId', authenticate, requireRoles('ADMIN', 'REGISTRAR'), getStudentDocuments);

/**
 * @swagger
 * /api/student-documents/{studentId}/issue:
 *   post:
 *     summary: Generate and issue documents from the saved document templates (Admin/Registrar)
 *     description: Slugs - admission-letter, letter-of-acceptance, admission-for-training, personal-information. Set regenerate to rebuild an already-issued copy from the current template.
 *     tags: [Student Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Per-document result
 */
router.post('/:studentId/issue', authenticate, requireRoles('ADMIN', 'REGISTRAR'), issueStudentDocuments);

/**
 * @swagger
 * /api/student-documents/{studentId}/{slug}/download:
 *   get:
 *     summary: Download an issued document as PDF (owner student, Admin, Registrar)
 *     description: Returns 404 until the document has been issued.
 *     tags: [Student Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: studentId, required: true, schema: { type: string } }
 *       - { in: path, name: slug, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: PDF file
 */
router.get('/:studentId/:slug/download', authenticate, requireRoles('STUDENT', 'ADMIN', 'REGISTRAR'), requirePasswordChange, downloadStudentDocument);

module.exports = router;

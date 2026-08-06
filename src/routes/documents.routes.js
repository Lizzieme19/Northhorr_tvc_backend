const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
  getLetterOfAcceptance,
  getAdmissionForTraining,
  getFeeStructure,
  getStudentPersonalInfo,
} = require('../controllers/documents.controller');

/**
 * @swagger
 * /api/students/{id}/documents/letter-of-acceptance:
 *   get:
 *     summary: Generate Letter of Acceptance document
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: DOCX file
 *         content:
 *           application/vnd.openxmlformats-officedocument.wordprocessingml.document:
 *             schema:
 *               type: string
 *               format: binary
 */
router.get('/students/:id/documents/letter-of-acceptance', authenticate, getLetterOfAcceptance);

/**
 * @swagger
 * /api/students/{id}/documents/admission-for-training:
 *   get:
 *     summary: Generate Admission for Training document
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: DOCX file
 */
router.get('/students/:id/documents/admission-for-training', authenticate, getAdmissionForTraining);

/**
 * @swagger
 * /api/students/{id}/documents/fee-structure:
 *   get:
 *     summary: Generate Fee Structure document
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: DOCX file
 */
router.get('/students/:id/documents/fee-structure', authenticate, getFeeStructure);

/**
 * @swagger
 * /api/students/{id}/documents/personal-information:
 *   get:
 *     summary: Generate Student Personal Information document
 *     tags: [Documents]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: DOCX file
 */
router.get('/students/:id/documents/personal-information', authenticate, getStudentPersonalInfo);

module.exports = router;

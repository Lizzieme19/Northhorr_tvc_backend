const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getAllTerms,
  getTermById,
  createTerm,
  updateTerm,
  deleteTerm,
  enrollStudentInTerm,
  unenrollStudentFromTerm,
} = require('../controllers/terms.controller');

/**
 * @swagger
 * /api/terms:
 *   get:
 *     summary: Get all terms
 *     tags: [Terms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: is_active
 *         schema:
 *           type: boolean
 *         description: Filter by active status
 *       - in: query
 *         name: academic_year
 *         schema:
 *           type: string
 *         description: Filter by academic year
 *     responses:
 *       200:
 *         description: List of terms
 */
router.get('/', authenticate, requireRoles('ADMIN', 'FINANCE'), getAllTerms);

/**
 * @swagger
 * /api/terms/{id}:
 *   get:
 *     summary: Get term by ID
 *     tags: [Terms]
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
 *         description: Term details
 */
router.get('/:id', authenticate, requireRoles('ADMIN', 'FINANCE'), getTermById);

/**
 * @swagger
 * /api/terms:
 *   post:
 *     summary: Create a new term
 *     tags: [Terms]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - start_date
 *               - end_date
 *               - academic_year
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Term 1 2024"
 *               start_date:
 *                 type: string
 *                 format: date
 *                 example: "2024-01-15"
 *               end_date:
 *                 type: string
 *                 format: date
 *                 example: "2024-04-15"
 *               academic_year:
 *                 type: string
 *                 example: "2024/2025"
 *               is_active:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       201:
 *         description: Term created
 */
router.post('/', authenticate, requireRoles('ADMIN'), createTerm);

/**
 * @swagger
 * /api/terms/{id}:
 *   patch:
 *     summary: Update a term
 *     tags: [Terms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               start_date:
 *                 type: string
 *                 format: date
 *               end_date:
 *                 type: string
 *                 format: date
 *               academic_year:
 *                 type: string
 *               is_active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Term updated
 */
router.patch('/:id', authenticate, requireRoles('ADMIN'), updateTerm);

/**
 * @swagger
 * /api/terms/{id}:
 *   delete:
 *     summary: Delete a term
 *     tags: [Terms]
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
 *         description: Term deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN'), deleteTerm);

/**
 * @swagger
 * /api/terms/{termId}/enroll/{studentId}:
 *   post:
 *     summary: Enroll a student in a term
 *     tags: [Terms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: termId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student enrolled
 */
router.post('/:termId/enroll/:studentId', authenticate, requireRoles('ADMIN'), enrollStudentInTerm);

/**
 * @swagger
 * /api/terms/{termId}/enroll/{studentId}:
 *   delete:
 *     summary: Unenroll a student from a term
 *     tags: [Terms]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: termId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student unenrolled
 */
router.delete('/:termId/enroll/:studentId', authenticate, requireRoles('ADMIN'), unenrollStudentFromTerm);

module.exports = router;

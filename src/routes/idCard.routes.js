const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getStudentIDCard,
  getMyIDCard,
  updateIDCardExpiry,
} = require('../controllers/idCard.controller');

/**
 * @swagger
 * /api/students/me/id-card:
 *   get:
 *     summary: Generate current student's ID card (Student only)
 *     tags: [ID Cards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: ID card PNG image
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Student missing profile picture or not active
 */
router.get('/students/me/id-card', authenticate, requireRoles('STUDENT'), getMyIDCard);

/**
 * @swagger
 * /api/students/:studentId/id-card:
 *   get:
 *     summary: Generate student ID card (Admin/Finance only)
 *     tags: [ID Cards]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: ID card PNG image
 *         content:
 *           image/png:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Student missing profile picture or not active
 *       404:
 *         description: Student not found
 */
router.get('/students/:studentId/id-card', authenticate, requireRoles('ADMIN', 'FINANCE'), getStudentIDCard);

/**
 * @swagger
 * /api/students/:studentId/id-card/expiry:
 *   patch:
 *     summary: Update student ID card expiry date (Admin/Finance only)
 *     tags: [ID Cards]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - expiry_date
 *             properties:
 *               expiry_date:
 *                 type: string
 *                 format: date
 *                 example: "2027-09-30"
 *     responses:
 *       200:
 *         description: Updated student record
 *       400:
 *         description: Invalid expiry date
 */
router.patch('/students/:studentId/id-card/expiry', authenticate, requireRoles('ADMIN', 'FINANCE'), updateIDCardExpiry);

module.exports = router;

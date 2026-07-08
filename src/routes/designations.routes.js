const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getDesignations,
  getDesignationById,
  createDesignation,
  updateDesignation,
  deleteDesignation,
} = require('../controllers/designations.controller');

/**
 * @swagger
 * /api/designations:
 *   get:
 *     summary: List all designations
 *     tags: [Staff Management]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of designations
 */
router.get('/', getDesignations);

/**
 * @swagger
 * /api/designations:
 *   post:
 *     summary: Create designation (Admin/HR only)
 *     tags: [Staff Management]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               salary_grade:
 *                 type: string
 *     responses:
 *       201:
 *         description: Designation created
 */
router.post('/', authenticate, requireRoles('ADMIN', 'HR'), createDesignation);

/**
 * @swagger
 * /api/designations/{id}:
 *   get:
 *     summary: Get designation by ID
 *     tags: [Staff Management]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Designation details
 */
router.get('/:id', getDesignationById);

/**
 * @swagger
 * /api/designations/{id}:
 *   patch:
 *     summary: Update designation (Admin/HR only)
 *     tags: [Staff Management]
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
 *     responses:
 *       200:
 *         description: Designation updated
 */
router.patch('/:id', authenticate, requireRoles('ADMIN', 'HR'), updateDesignation);

/**
 * @swagger
 * /api/designations/{id}:
 *   delete:
 *     summary: Delete designation (Admin/HR only)
 *     tags: [Staff Management]
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
 *         description: Designation deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN', 'HR'), deleteDesignation);

module.exports = router;

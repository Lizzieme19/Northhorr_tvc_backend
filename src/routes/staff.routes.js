const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const {
  getStaff,
  getStaffById,
  getMyStaffProfile,
  createStaff,
  updateStaff,
  deleteStaff,
  getStaffStats,
} = require('../controllers/staff.controller');

/**
 * @swagger
 * /api/staff:
 *   get:
 *     summary: List all staff members (Admin/HR only)
 *     tags: [Staff Management]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: department_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: designation_id
 *         schema:
 *           type: string
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [ACTIVE, INACTIVE, ON_LEAVE]
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
 *         description: List of staff members
 */
router.get('/', authenticate, requireRoles('ADMIN', 'HR'), getStaff);

/**
 * @swagger
 * /api/staff/stats:
 *   get:
 *     summary: Get staff statistics (Admin/HR only)
 *     tags: [Staff Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Staff statistics
 */
router.get('/stats', authenticate, requireRoles('ADMIN', 'HR'), getStaffStats);

/**
 * @swagger
 * /api/staff:
 *   post:
 *     summary: Create new staff member (Admin/HR only)
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
 *               user_id:
 *                 type: string
 *               employee_number:
 *                 type: string
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               designation_id:
 *                 type: string
 *               department_id:
 *                 type: string
 *               employment_date:
 *                 type: string
 *                 format: date
 *               employment_type:
 *                 type: string
 *                 enum: [FULL_TIME, PART_TIME, CONTRACT]
 *               salary:
 *                 type: number
 *     responses:
 *       201:
 *         description: Staff member created
 */
router.post('/', authenticate, requireRoles('ADMIN', 'HR'), createStaff);

/**
 * @swagger
 * /api/staff/me:
 *   get:
 *     summary: Get current staff profile
 *     tags: [Staff Management]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Staff profile
 */
router.get('/me', authenticate, requireRoles('STAFF'), getMyStaffProfile);

/**
 * @swagger
 * /api/staff/{id}:
 *   get:
 *     summary: Get staff member by ID (Admin/HR only)
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
 *         description: Staff member details
 */
router.get('/:id', authenticate, requireRoles('ADMIN', 'HR'), getStaffById);

/**
 * @swagger
 * /api/staff/{id}:
 *   patch:
 *     summary: Update staff member (Admin/HR only)
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
 *         description: Staff member updated
 */
router.patch('/:id', authenticate, requireRoles('ADMIN', 'HR'), updateStaff);

/**
 * @swagger
 * /api/staff/{id}:
 *   delete:
 *     summary: Delete staff member (Admin/HR only)
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
 *         description: Staff member deleted
 */
router.delete('/:id', authenticate, requireRoles('ADMIN', 'HR'), deleteStaff);

module.exports = router;

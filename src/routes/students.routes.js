const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');
const { reassignTerm, removeTerm, getStudentTerms } = require('../controllers/feeCorrections.controller');
const { previewStudentImport, importStudents, downloadImportTemplate } = require('../controllers/studentImport.controller');
const { requirePasswordChange } = require('../middleware/requirePasswordChange');
const { upload, spreadsheetUpload } = require('../middleware/upload');
const {
  getStudents,
  getStudentById,
  getMyProfile,
  updateStudent,
  updateMyProfile,
  uploadPhoto,
  uploadStudentDocuments,
  uploadMyDocuments,
  getStudentStats,
  uploadMyProfilePicture,
  generateIdCard,
  generatePrefilledDocument,
  enrollInTerm,
  getMyEnrollments,
  assignStudentTerm,
  bulkAssignTerm,
  mergeStudentRecords,
  deleteStudent,
  getDuplicates,
} = require('../controllers/students.controller');

/**
 * @swagger
 * /api/students:
 *   get:
 *     summary: List all students (Admin/Finance/Dept Head only)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
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
 *         description: List of students
 */
router.get('/', authenticate, requireRoles('ADMIN', 'FINANCE', 'DEPT_HEAD', 'REGISTRAR'), getStudents);

/**
 * @swagger
 * /api/students/stats:
 *   get:
 *     summary: Get student statistics (Admin only)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Student statistics
 */
router.get('/stats', authenticate, requireRoles('ADMIN', 'REGISTRAR'), getStudentStats);

/**
 * @swagger
 * /api/students/me:
 *   get:
 *     summary: Get current student profile
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Student profile
 */
router.get('/me', authenticate, requireRoles('STUDENT'), requirePasswordChange, getMyProfile);

/**
 * @swagger
 * /api/students/me:
 *   patch:
 *     summary: Update current student profile
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               phone:
 *                 type: string
 *               address:
 *                 type: string
 *               id_number:
 *                 type: string
 *               emergency_contact_name:
 *                 type: string
 *               emergency_contact_phone:
 *                 type: string
 *               profile_picture_url:
 *                 type: string
 *               id_copy_front_url:
 *                 type: string
 *               id_copy_back_url:
 *                 type: string
 *               parent_id_copy_front_url:
 *                 type: string
 *               parent_id_copy_back_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.patch('/me', authenticate, requireRoles('STUDENT'), requirePasswordChange, updateMyProfile);

/**
 * @swagger
 * /api/students/me/profile-picture:
 *   patch:
 *     summary: Upload profile picture
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               profile_picture:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Profile picture uploaded
 */
router.patch('/me/profile-picture', authenticate, requireRoles('STUDENT'), requirePasswordChange, upload.single('profile_picture'), uploadMyProfilePicture);

/**
 * @swagger
 * /api/students/me/documents:
 *   patch:
 *     summary: Upload student supporting documents (Student self-service)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               medical_report:
 *                 type: string
 *                 format: binary
 *               kcse_certificate:
 *                 type: string
 *                 format: binary
 *               birth_certificate:
 *                 type: string
 *                 format: binary
 *               other_documents:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Documents uploaded successfully
 */
router.patch('/me/documents', authenticate, requireRoles('STUDENT'), requirePasswordChange, upload.fields([
  { name: 'medical_report', maxCount: 1 },
  { name: 'kcse_certificate', maxCount: 1 },
  { name: 'birth_certificate', maxCount: 1 },
  { name: 'other_documents', maxCount: 1 },
]), uploadMyDocuments);

/**
 * @swagger
 * /api/students/{id}:
 *   get:
 *     summary: Get student by ID
 *     tags: [Students]
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
 *         description: Student details
 */
router.get('/:id', authenticate, getStudentById);

/**
 * @swagger
 * /api/students/{id}:
 *   patch:
 *     summary: Update student (Admin or Dept Head only)
 *     tags: [Students]
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
 *               level:
 *                 type: string
 *               intake:
 *                 type: string
 *               year:
 *                 type: integer
 *               status:
 *                 type: string
 *                 enum: [ACTIVE, GRADUATED, WITHDRAWN, SUSPENDED]
 *               helb_applied:
 *                 type: boolean
 *               course_id:
 *                 type: string
 *               department_id:
 *                 type: string
 *               profile_picture_url:
 *                 type: string
 *               id_copy_front_url:
 *                 type: string
 *               id_copy_back_url:
 *                 type: string
 *               parent_id_copy_front_url:
 *                 type: string
 *               parent_id_copy_back_url:
 *                 type: string
 *     responses:
 *       200:
 *         description: Student updated
 *       403:
 *         description: Access denied (Dept Head can only update students in their department)
 */
router.patch('/:id', authenticate, requireRoles('ADMIN', 'DEPT_HEAD', 'REGISTRAR'), updateStudent);

/**
 * @swagger
 * /api/students/{id}/documents:
 *   post:
 *     summary: Upload student ID documents (Admin only)
 *     tags: [Students]
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               id_copy_front:
 *                 type: string
 *                 format: binary
 *               id_copy_back:
 *                 type: string
 *                 format: binary
 *               parent_id_copy_front:
 *                 type: string
 *                 format: binary
 *               parent_id_copy_back:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Documents uploaded
 *       403:
 *         description: Access denied
 */
router.post('/:id/documents', authenticate, requireRoles('ADMIN', 'REGISTRAR'), upload.fields([
  { name: 'id_copy_front', maxCount: 1 },
  { name: 'id_copy_back', maxCount: 1 },
  { name: 'parent_id_copy_front', maxCount: 1 },
  { name: 'parent_id_copy_back', maxCount: 1 },
  { name: 'kcse_certificate', maxCount: 1 },
  { name: 'birth_certificate', maxCount: 1 },
  { name: 'other_documents', maxCount: 1 },
]), uploadStudentDocuments);

/**
 * @swagger
 * /api/students/{id}/photo:
 *   post:
 *     summary: Upload student photo
 *     tags: [Students]
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Photo uploaded
 */
router.post('/:id/photo', authenticate, upload.single('photo'), uploadPhoto);

/**
 * @swagger
 * /api/students/documents/{type}:
 *   get:
 *     summary: Generate prefilled document (Student only)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [admission_form, medical_form]
 *     responses:
 *       200:
 *         description: Document generated
 *       404:
 *         description: Student not found
 */
router.get('/documents/:type', authenticate, requireRoles('STUDENT'), requirePasswordChange, generatePrefilledDocument);

/**
 * @swagger
 * /api/students/me/enrollments:
 *   get:
 *     summary: Get current student's term enrollments
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Student's term enrollments
 */
router.get('/me/enrollments', authenticate, requireRoles('STUDENT'), requirePasswordChange, getMyEnrollments);

/**
 * @swagger
 * /api/students/me/enroll/{termId}:
 *   post:
 *     summary: Enroll in a term (Student self-enrollment)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: termId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully enrolled
 *       400:
 *         description: Cannot enroll (reason provided)
 */
router.post('/me/enroll/:termId', authenticate, requireRoles('STUDENT'), requirePasswordChange, enrollInTerm);

/**
 * @swagger
 * /api/students/{id}/term/{termId}:
 *   post:
 *     summary: Assign student to term (Admin only)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: termId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Term assigned successfully
 */
router.post('/:id/term/:termId', authenticate, requireRoles('ADMIN', 'REGISTRAR'), assignStudentTerm);

/**
 * @swagger
 * /api/students/bulk-assign-term:
 *   post:
 *     summary: Bulk assign students to a term (Admin/Finance/Dept Head only)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               studentIds:
 *                 type: array
 *                 items:
 *                   type: string
 *               termId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Bulk term assignment completed
 */
router.post('/bulk-assign-term', authenticate, requireRoles('ADMIN', 'FINANCE', 'DEPT_HEAD', 'REGISTRAR'), bulkAssignTerm);

/**
 * @swagger
 * /api/students/import/template:
 *   get:
 *     summary: Download the student import template (Excel) with instructions and the course/term lists (Admin/Registrar)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Excel template
 */
router.get('/import/template', authenticate, requireRoles('ADMIN', 'REGISTRAR'), downloadImportTemplate);

/**
 * @swagger
 * /api/students/import/preview:
 *   post:
 *     summary: Check a CSV, XLS or XLSX file of students and report what an import would do (Admin/Registrar). Creates nothing.
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               allow_similar:
 *                 type: string
 *                 description: "true to also import rows that look like students who already exist"
 *     responses:
 *       200:
 *         description: Row-by-row results with errors, duplicates and warnings
 */
router.post('/import/preview', authenticate, requireRoles('ADMIN', 'REGISTRAR'), spreadsheetUpload.single('file'), previewStudentImport);

/**
 * @swagger
 * /api/students/import:
 *   post:
 *     summary: Import students from a CSV, XLS or XLSX file (Admin/Registrar). Rows with problems are skipped and reported.
 *     description: Each student gets a login with a temporary password that must be changed at first sign-in. The passwords are returned once in the response.
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *               allow_similar:
 *                 type: string
 *     responses:
 *       200:
 *         description: Import summary and temporary credentials
 */
router.post('/import', authenticate, requireRoles('ADMIN', 'REGISTRAR'), spreadsheetUpload.single('file'), importStudents);

/**
 * @swagger
 * /api/students/duplicates:
 *   get:
 *     summary: Find students with duplicate names (Admin only)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Groups of duplicate students
 */
router.get('/duplicates', authenticate, requireRoles('ADMIN', 'REGISTRAR'), getDuplicates);

/**
 * @swagger
 * /api/students/{id}:
 *   delete:
 *     summary: Delete a student and all linked records (Admin only)
 *     tags: [Students]
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
 *         description: Student deleted
 *       404:
 *         description: Student not found
 */
/**
 * @swagger
 * /api/students/{id}/merge:
 *   post:
 *     summary: Link an older record of the same student into this one (Admin/Registrar)
 *     description: Balances, payments, documents and history move to this record; the older admission number, intake and dates become a history stage and the older record is removed.
 *     tags: [Students]
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
 *               merge_student_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Records linked
 */
router.post('/:id/merge', authenticate, requireRoles('ADMIN', 'REGISTRAR'), mergeStudentRecords);

/**
 * @swagger
 * /api/students/{id}/terms/{termId}/reassign:
 *   post:
 *     summary: Move a student's term assignment (and its payments) to the correct term (Admin/Finance/Registrar)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: termId, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               to_term_id: { type: string }
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Moved and fees recalculated
 */
router.get('/:id/terms', authenticate, requireRoles('ADMIN', 'FINANCE', 'REGISTRAR'), getStudentTerms);
router.post('/:id/terms/:termId/reassign', authenticate, requireRoles('ADMIN', 'FINANCE', 'REGISTRAR'), reassignTerm);

/**
 * @swagger
 * /api/students/{id}/terms/{termId}:
 *   delete:
 *     summary: Remove a wrong term assignment - only when nothing was paid against it (Admin/Finance/Registrar)
 *     tags: [Students]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: termId, required: true, schema: { type: string } }
 *     responses:
 *       200:
 *         description: Removed
 */
router.delete('/:id/terms/:termId', authenticate, requireRoles('ADMIN', 'FINANCE', 'REGISTRAR'), removeTerm);

router.delete('/:id', authenticate, requireRoles('ADMIN'), deleteStudent);

module.exports = router;

const express = require('express');
const router = express.Router();
const {
  login,
  refresh,
  logout,
  changePassword,
  createStaffAccount,
  getMe,
} = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { requireRoles } = require('../middleware/roles');

// Public
router.post('/login', login);
router.post('/refresh', refresh);

// Authenticated
router.post('/logout', authenticate, logout);
router.post('/change-password', authenticate, changePassword);
router.get('/me', authenticate, getMe);

// Admin only — create staff accounts
router.post('/create-staff', authenticate, requireRoles('ADMIN'), createStaffAccount);

module.exports = router;

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../config/db');

const generateTokens = (userId, role) => {
  const accessToken = jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Check if login is using admission number
    let user;
    const studentByAdmission = await prisma.student.findUnique({
      where: { admission_no: email },
      include: { user: true },
    });

    if (studentByAdmission) {
      user = studentByAdmission.user;
    } else {
      user = await prisma.user.findUnique({ where: { email } });
    }

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check fee clearance for students
    if (user.role === 'STUDENT') {
      const student = await prisma.student.findUnique({
        where: { user_id: user.id },
        include: { fee_records: true },
      });

      if (!student) {
        return res.status(401).json({ error: 'Student record not found' });
      }

      // Check if fees are cleared
      const totalFees = student.fee_records.reduce((sum, record) => sum + record.amount, 0);
      const paidFees = student.fee_records
        .filter(record => record.status === 'PAID')
        .reduce((sum, record) => sum + record.amount, 0);

      if (paidFees < totalFees) {
        return res.status(403).json({ 
          error: 'Fee clearance required',
          message: 'Please clear your fees before logging in',
          totalFees,
          paidFees,
          balance: totalFees - paidFees,
        });
      }
    }

    const { accessToken, refreshToken } = generateTokens(user.id, user.role);

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        user_id: user.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Get student info if applicable
    let studentInfo = null;
    if (user.role === 'STUDENT') {
      studentInfo = await prisma.student.findUnique({
        where: { user_id: user.id },
        select: { id: true, admission_no: true },
      });
    }

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: user.must_change_password,
        studentId: studentInfo?.id || null,
        admissionNo: studentInfo?.admission_no || null,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
};

// POST /api/auth/refresh
const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } });

    if (!stored || stored.expires_at < new Date()) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Rotate tokens
    await prisma.refreshToken.delete({ where: { token: refreshToken } });
    const tokens = generateTokens(user.id, user.role);

    await prisma.refreshToken.create({
      data: {
        token: tokens.refreshToken,
        user_id: user.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    res.json(tokens);
  } catch (err) {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
};

// POST /api/auth/logout
const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/auth/change-password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both current and new password required' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { 
        password: hashed,
        must_change_password: false,
      },
    });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/auth/create-staff (Admin only)
const createStaffAccount = async (req, res) => {
  try {
    const { email, password, role, department_id } = req.body;
    const allowedRoles = ['ADMIN', 'DEPT_HEAD', 'FINANCE', 'STAFF', 'PROCUREMENT', 'HR'];

    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Email, password, and role are required' });
    }
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${allowedRoles.join(', ')}` });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { email, password: hashed, role },
      select: { id: true, email: true, role: true, created_at: true },
    });

    // If dept head, link to department
    if (role === 'DEPT_HEAD' && department_id) {
      await prisma.department.update({
        where: { id: department_id },
        data: { head_user_id: user.id },
      });
    }

    res.status(201).json({ message: 'Staff account created', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/auth/me
const getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, email: true, role: true, created_at: true,
        student: {
          select: {
            id: true, admission_no: true, level: true, intake: true, year: true,
            photo_url: true, status: true,
            course: { select: { id: true, name: true } },
            department: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/auth/users (Admin only)
const getAllUsers = async (req, res) => {
  try {
    const { role, page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (role) where.role = role;
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          role: true,
          is_active: true,
          must_change_password: true,
          created_at: true,
          student: {
            select: {
              id: true,
              admission_no: true,
              status: true,
              course: { select: { name: true } },
              department: { select: { name: true } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      users,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/auth/users/:id (Admin only)
const updateUserStatus = async (req, res) => {
  try {
    const { is_active } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { is_active },
      select: { id: true, email: true, role: true, is_active: true },
    });

    res.json(updated);
  } catch (err) {
    console.error('Update user status error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { login, refresh, logout, changePassword, createStaffAccount, getMe, getAllUsers, updateUserStatus };

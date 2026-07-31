const prisma = require('../config/db');

const requirePasswordChange = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { must_change_password: true, role: true },
    });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Allow password change endpoint even if must_change_password is true
    if (req.path === '/api/auth/change-password' && req.method === 'POST') {
      return next();
    }

    // Allow logout endpoint
    if (req.path === '/api/auth/logout' && req.method === 'POST') {
      return next();
    }

    // Allow GET /api/auth/me endpoint
    if (req.path === '/api/auth/me' && req.method === 'GET') {
      return next();
    }

    if (user.must_change_password) {
      return res.status(403).json({
        error: 'Password change required',
        message: 'You must change your password before accessing this resource',
        mustChangePassword: true,
      });
    }

    next();
  } catch (err) {
    console.error('Password change check error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { requirePasswordChange };

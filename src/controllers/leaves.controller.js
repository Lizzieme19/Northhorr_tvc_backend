const prisma = require('../config/db');

// GET /api/leaves - List leave requests (HR, ADMIN)
const getLeaveRequests = async (req, res) => {
  try {
    const { status, staff_id, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (staff_id) where.staff_id = staff_id;

    const [leaves, total] = await Promise.all([
      prisma.leaveRequest.findMany({
        where,
        include: {
          staff: {
            include: {
              user: { select: { email: true } },
              designation: { select: { title: true } },
              department: { select: { name: true } },
            },
          },
          approver: { select: { email: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.leaveRequest.count({ where }),
    ]);

    res.json({
      leaves,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/leaves/:id - Get leave request by ID
const getLeaveRequestById = async (req, res) => {
  try {
    const leave = await prisma.leaveRequest.findUnique({
      where: { id: req.params.id },
      include: {
        staff: {
          include: {
            user: { select: { email: true } },
            designation: { select: { title: true } },
            department: { select: { name: true } },
          },
        },
        approver: { select: { email: true } },
      },
    });

    if (!leave) return res.status(404).json({ error: 'Leave request not found' });

    res.json(leave);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/leaves/me - Get own leave requests
const getMyLeaveRequests = async (req, res) => {
  try {
    const staff = await prisma.staff.findUnique({
      where: { user_id: req.user.id },
    });

    if (!staff) return res.status(404).json({ error: 'Staff profile not found' });

    const leaves = await prisma.leaveRequest.findMany({
      where: { staff_id: staff.id },
      include: {
        approver: { select: { email: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    res.json(leaves);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/leaves - Create leave request
const createLeaveRequest = async (req, res) => {
  try {
    const { leave_type, start_date, end_date, reason, attachments } = req.body;

    if (!leave_type || !start_date || !end_date) {
      return res.status(400).json({ error: 'Leave type, start date, and end date are required' });
    }

    const staff = await prisma.staff.findUnique({
      where: { user_id: req.user.id },
    });

    if (!staff) return res.status(404).json({ error: 'Staff profile not found' });

    // Calculate total days
    const startDate = new Date(start_date);
    const endDate = new Date(end_date);
    const diffTime = Math.abs(endDate - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    // Check leave balance
    const currentYear = new Date().getFullYear();
    const leaveBalance = await prisma.leaveBalance.findUnique({
      where: {
        staff_id_leave_type_year: {
          staff_id: staff.id,
          leave_type,
          year: currentYear,
        },
      },
    });

    if (!leaveBalance) {
      return res.status(400).json({ error: 'Leave balance not found for this type' });
    }

    const availableDays = leaveBalance.total_days - leaveBalance.used_days;
    if (diffDays > availableDays) {
      return res.status(400).json({ 
        error: `Insufficient leave balance. Available: ${availableDays} days, Requested: ${diffDays} days` 
      });
    }

    const leave = await prisma.leaveRequest.create({
      data: {
        staff_id: staff.id,
        leave_type,
        start_date: new Date(start_date),
        end_date: new Date(end_date),
        total_days: diffDays,
        reason,
        attachments,
      },
      include: {
        staff: {
          include: {
            user: { select: { email: true } },
            designation: { select: { title: true } },
          },
        },
      },
    });

    res.status(201).json(leave);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/leaves/:id/approve - Approve leave request (HR, ADMIN)
const approveLeaveRequest = async (req, res) => {
  try {
    const { rejection_reason } = req.body;
    const { status } = req.body; // APPROVED or REJECTED

    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ error: 'Status must be APPROVED or REJECTED' });
    }

    const leave = await prisma.leaveRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!leave) return res.status(404).json({ error: 'Leave request not found' });
    if (leave.status !== 'PENDING') {
      return res.status(400).json({ error: 'Leave request has already been processed' });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data: {
        status,
        approved_by: req.user.id,
        approved_at: new Date(),
        rejection_reason: status === 'REJECTED' ? rejection_reason : null,
      },
    });

    // If approved, deduct from leave balance
    if (status === 'APPROVED') {
      const currentYear = new Date().getFullYear();
      await prisma.leaveBalance.update({
        where: {
          staff_id_leave_type_year: {
            staff_id: leave.staff_id,
            leave_type: leave.leave_type,
            year: currentYear,
          },
        },
        data: {
          used_days: { increment: leave.total_days },
        },
      });
    }

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/leaves/:id/cancel - Cancel own leave request
const cancelLeaveRequest = async (req, res) => {
  try {
    const staff = await prisma.staff.findUnique({
      where: { user_id: req.user.id },
    });

    if (!staff) return res.status(404).json({ error: 'Staff profile not found' });

    const leave = await prisma.leaveRequest.findUnique({
      where: { id: req.params.id },
    });

    if (!leave) return res.status(404).json({ error: 'Leave request not found' });
    if (leave.staff_id !== staff.id) {
      return res.status(403).json({ error: 'Can only cancel your own leave requests' });
    }
    if (leave.status !== 'PENDING') {
      return res.status(400).json({ error: 'Can only cancel pending leave requests' });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED' },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/leaves/balance/:staff_id - Get leave balance for a staff member
const getLeaveBalance = async (req, res) => {
  try {
    const { staff_id } = req.params;
    const { year } = req.query;
    const currentYear = year ? parseInt(year) : new Date().getFullYear();

    const balances = await prisma.leaveBalance.findMany({
      where: {
        staff_id,
        year: currentYear,
      },
    });

    res.json(balances);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/leaves/balance - Get own leave balance
const getMyLeaveBalance = async (req, res) => {
  try {
    const staff = await prisma.staff.findUnique({
      where: { user_id: req.user.id },
    });

    if (!staff) return res.status(404).json({ error: 'Staff profile not found' });

    const { year } = req.query;
    const currentYear = year ? parseInt(year) : new Date().getFullYear();

    const balances = await prisma.leaveBalance.findMany({
      where: {
        staff_id: staff.id,
        year: currentYear,
      },
    });

    res.json(balances);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getLeaveRequests,
  getLeaveRequestById,
  getMyLeaveRequests,
  createLeaveRequest,
  approveLeaveRequest,
  cancelLeaveRequest,
  getLeaveBalance,
  getMyLeaveBalance,
};

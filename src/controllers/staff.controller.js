const prisma = require('../config/db');

const staffIncludes = {
  user: { select: { id: true, email: true, role: true } },
  designation: { select: { id: true, title: true, grade_level: true } },
  department: { select: { id: true, name: true, shortcode: true } },
  reports_to: {
    select: {
      id: true,
      employee_number: true,
      first_name: true,
      last_name: true,
      designation: { select: { title: true } },
    },
  },
};

// GET /api/staff - List all staff (HR, ADMIN)
const getStaff = async (req, res) => {
  try {
    const { department_id, employment_status, page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (department_id) where.department_id = department_id;
    if (employment_status) where.employment_status = employment_status;
    if (search) {
      where.OR = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { employee_number: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [staff, total] = await Promise.all([
      prisma.staff.findMany({
        where,
        include: staffIncludes,
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.staff.count({ where }),
    ]);

    res.json({
      staff,
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

// GET /api/staff/:id - Get staff by ID
const getStaffById = async (req, res) => {
  try {
    const staff = await prisma.staff.findUnique({
      where: { id: req.params.id },
      include: {
        ...staffIncludes,
        subordinates: {
          include: {
            designation: { select: { title: true } },
            department: { select: { name: true } },
          },
        },
        leave_requests: { orderBy: { created_at: 'desc' }, take: 5 },
        leave_balances: true,
        employment_records: { orderBy: { start_date: 'desc' } },
      },
    });

    if (!staff) return res.status(404).json({ error: 'Staff not found' });

    res.json(staff);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/staff/me - Get own staff profile
const getMyStaffProfile = async (req, res) => {
  try {
    const staff = await prisma.staff.findUnique({
      where: { user_id: req.user.id },
      include: {
        ...staffIncludes,
        leave_requests: { orderBy: { created_at: 'desc' } },
        leave_balances: true,
      },
    });

    if (!staff) return res.status(404).json({ error: 'Staff profile not found' });

    res.json(staff);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/staff - Create new staff (HR, ADMIN)
const createStaff = async (req, res) => {
  try {
    const {
      user_id,
      employee_number,
      designation_id,
      department_id,
      reports_to_id,
      first_name,
      last_name,
      gender,
      date_of_birth,
      phone,
      address,
      emergency_contact,
      emergency_phone,
      employment_type,
      date_hired,
      salary,
      bank_account,
      bank_name,
      kra_pin,
      nssf_number,
      nhif_number,
    } = req.body;

    // Generate employee number if not provided
    const empNumber = employee_number || `STF${Date.now().toString().slice(-6)}`;

    const staff = await prisma.staff.create({
      data: {
        user_id,
        employee_number: empNumber,
        designation_id,
        department_id,
        reports_to_id,
        first_name,
        last_name,
        gender,
        date_of_birth: new Date(date_of_birth),
        phone,
        address,
        emergency_contact,
        emergency_phone,
        employment_type,
        date_hired: new Date(date_hired),
        salary: parseFloat(salary),
        bank_account,
        bank_name,
        kra_pin,
        nssf_number,
        nhif_number,
      },
      include: staffIncludes,
    });

    // Initialize leave balances for the current year
    const currentYear = new Date().getFullYear();
    await prisma.leaveBalance.createMany({
      data: [
        { staff_id: staff.id, leave_type: 'ANNUAL', year: currentYear, total_days: 21 },
        { staff_id: staff.id, leave_type: 'SICK', year: currentYear, total_days: 14 },
        { staff_id: staff.id, leave_type: 'COMPASSIONATE', year: currentYear, total_days: 7 },
      ],
    });

    res.status(201).json(staff);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/staff/:id - Update staff (HR, ADMIN)
const updateStaff = async (req, res) => {
  try {
    const {
      designation_id,
      department_id,
      reports_to_id,
      first_name,
      last_name,
      phone,
      address,
      emergency_contact,
      emergency_phone,
      employment_status,
      employment_type,
      salary,
      bank_account,
      bank_name,
      kra_pin,
      nssf_number,
      nhif_number,
    } = req.body;

    const staff = await prisma.staff.update({
      where: { id: req.params.id },
      data: {
        ...(designation_id && { designation_id }),
        ...(department_id && { department_id }),
        ...(reports_to_id !== undefined && { reports_to_id }),
        ...(first_name && { first_name }),
        ...(last_name && { last_name }),
        ...(phone && { phone }),
        ...(address !== undefined && { address }),
        ...(emergency_contact !== undefined && { emergency_contact }),
        ...(emergency_phone && { emergency_phone }),
        ...(employment_status && { employment_status }),
        ...(employment_type && { employment_type }),
        ...(salary && { salary: parseFloat(salary) }),
        ...(bank_account !== undefined && { bank_account }),
        ...(bank_name !== undefined && { bank_name }),
        ...(kra_pin !== undefined && { kra_pin }),
        ...(nssf_number !== undefined && { nssf_number }),
        ...(nhif_number !== undefined && { nhif_number }),
      },
      include: staffIncludes,
    });

    res.json(staff);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/staff/:id - Delete staff (HR, ADMIN)
const deleteStaff = async (req, res) => {
  try {
    await prisma.staff.delete({ where: { id: req.params.id } });
    res.json({ message: 'Staff deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/staff/stats - HR analytics
const getStaffStats = async (req, res) => {
  try {
    const [
      totalStaff,
      activeStaff,
      onLeave,
      byDepartment,
      byDesignation,
    ] = await Promise.all([
      prisma.staff.count(),
      prisma.staff.count({ where: { employment_status: 'ACTIVE' } }),
      prisma.staff.count({ where: { employment_status: 'ON_LEAVE' } }),
      prisma.staff.groupBy({
        by: ['department_id'],
        _count: true,
      }),
      prisma.staff.groupBy({
        by: ['designation_id'],
        _count: true,
      }),
    ]);

    res.json({
      totalStaff,
      activeStaff,
      onLeave,
      byDepartment,
      byDesignation,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getStaff,
  getStaffById,
  getMyStaffProfile,
  createStaff,
  updateStaff,
  deleteStaff,
  getStaffStats,
};

const prisma = require('../config/db');

// GET /api/designations - List all designations
const getDesignations = async (req, res) => {
  try {
    const designations = await prisma.designation.findMany({
      include: {
        _count: {
          select: { staff: true },
        },
      },
      orderBy: { title: 'asc' },
    });
    res.json(designations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/designations/:id - Get designation by ID
const getDesignationById = async (req, res) => {
  try {
    const designation = await prisma.designation.findUnique({
      where: { id: req.params.id },
      include: {
        staff: {
          include: {
            user: { select: { email: true } },
            department: { select: { name: true } },
          },
        },
      },
    });

    if (!designation) return res.status(404).json({ error: 'Designation not found' });

    res.json(designation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/designations - Create designation (HR, ADMIN)
const createDesignation = async (req, res) => {
  try {
    const { title, grade_level, description, salary_min, salary_max, responsibilities } = req.body;

    if (!title) return res.status(400).json({ error: 'Title is required' });

    const designation = await prisma.designation.create({
      data: {
        title,
        grade_level,
        description,
        salary_min: salary_min ? parseFloat(salary_min) : null,
        salary_max: salary_max ? parseFloat(salary_max) : null,
        responsibilities,
      },
    });

    res.status(201).json(designation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/designations/:id - Update designation (HR, ADMIN)
const updateDesignation = async (req, res) => {
  try {
    const { title, grade_level, description, salary_min, salary_max, responsibilities } = req.body;

    const designation = await prisma.designation.update({
      where: { id: req.params.id },
      data: {
        ...(title && { title }),
        ...(grade_level !== undefined && { grade_level }),
        ...(description !== undefined && { description }),
        ...(salary_min !== undefined && { salary_min: parseFloat(salary_min) }),
        ...(salary_max !== undefined && { salary_max: parseFloat(salary_max) }),
        ...(responsibilities !== undefined && { responsibilities }),
      },
    });

    res.json(designation);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /api/designations/:id - Delete designation (HR, ADMIN)
const deleteDesignation = async (req, res) => {
  try {
    const designation = await prisma.designation.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { staff: true } } },
    });

    if (!designation) return res.status(404).json({ error: 'Designation not found' });

    if (designation._count.staff > 0) {
      return res.status(400).json({ error: 'Cannot delete designation with assigned staff' });
    }

    await prisma.designation.delete({ where: { id: req.params.id } });
    res.json({ message: 'Designation deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getDesignations,
  getDesignationById,
  createDesignation,
  updateDesignation,
  deleteDesignation,
};

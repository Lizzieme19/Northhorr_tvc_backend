const prisma = require('../config/db');

const getCourses = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, department_id } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (department_id) {
      where.department_id = department_id;
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { shortcode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        include: {
          department: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { name: 'asc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.course.count({ where }),
    ]);

    res.json({
      courses,
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

const createCourse = async (req, res) => {
  try {
    const { name, levels, shortcode, department_id } = req.body;
    if (!name || !levels || !shortcode || !department_id) {
      return res.status(400).json({ error: 'Missing required fields: name, levels, shortcode, department_id' });
    }

    const cleanShortcode = shortcode.trim().toUpperCase();

    // Check if shortcode or name is already taken
    const existing = await prisma.course.findFirst({
      where: {
        OR: [
          { shortcode: cleanShortcode },
          { name, department_id }
        ]
      }
    });

    if (existing) {
      if (existing.shortcode === cleanShortcode) {
        return res.status(400).json({ error: 'A course with this shortcode already exists' });
      }
      return res.status(400).json({ error: 'A course with this name already exists in this department' });
    }

    const course = await prisma.course.create({
      data: {
        name,
        levels,
        shortcode: cleanShortcode,
        department_id,
      },
    });

    res.status(201).json(course);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, levels, shortcode, department_id } = req.body;

    const course = await prisma.course.findUnique({ where: { id } });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    let cleanShortcode;
    if (shortcode) {
      cleanShortcode = shortcode.trim().toUpperCase();
      const duplicate = await prisma.course.findFirst({
        where: { shortcode: cleanShortcode, id: { not: id } },
      });
      if (duplicate) {
        return res.status(400).json({ error: 'A course with this shortcode already exists' });
      }
    }

    if (name && department_id) {
      const duplicate = await prisma.course.findFirst({
        where: { name, department_id, id: { not: id } },
      });
      if (duplicate) {
        return res.status(400).json({ error: 'A course with this name already exists in this department' });
      }
    }

    const updated = await prisma.course.update({
      where: { id },
      data: {
        name: name || course.name,
        levels: levels || course.levels,
        shortcode: cleanShortcode || course.shortcode,
        department_id: department_id || course.department_id,
      },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

const deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;

    const course = await prisma.course.findUnique({
      where: { id },
      include: {
        _count: {
          select: { students: true, applications: true }
        }
      }
    });
    if (!course) return res.status(404).json({ error: 'Course not found' });

    if (course._count.students > 0 || course._count.applications > 0) {
      return res.status(400).json({
        error: 'Cannot delete course: it has associated students or applications'
      });
    }

    await prisma.course.delete({ where: { id } });
    res.json({ message: 'Course deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getCourses,
  createCourse,
  updateCourse,
  deleteCourse,
};

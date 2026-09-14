const prisma = require('../config/db');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the levels JSON string stored on a Course into an array of level
 * objects. Falls back gracefully for legacy comma-separated strings.
 */
function parseLevels(levelsStr) {
  if (!levelsStr) return [];
  const trimmed = levelsStr.trim();
  if (trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch (_) { /* fall through */ }
  }
  // Legacy: comma-separated string
  return trimmed.split(',').map(s => ({
    name: s.trim(),
    entry_requirement: 'KCSE',
    min_kcse_grade: null,
    min_kcpe_marks: null,
  }));
}

/**
 * Validate and normalise an incoming levels array from the API body.
 * Accepts either a JSON string or a plain JS array.
 */
function normaliseLevels(levelsInput) {
  let arr;
  if (typeof levelsInput === 'string') {
    try {
      arr = JSON.parse(levelsInput);
    } catch (_) {
      // Legacy comma-separated — auto-convert
      arr = levelsInput.split(',').map(s => ({
        name: s.trim(),
        entry_requirement: 'KCSE',
        min_kcse_grade: null,
        min_kcpe_marks: null,
      }));
    }
  } else if (Array.isArray(levelsInput)) {
    arr = levelsInput;
  } else {
    return { error: 'levels must be a JSON array of level objects' };
  }

  const VALID_ENTRY_REQS = ['KCPE', 'KCSE', 'NONE'];
  const VALID_KCSE_GRADES = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'E'];

  const normalised = [];
  for (const item of arr) {
    if (!item.name || typeof item.name !== 'string') {
      return { error: 'Each level must have a "name" field' };
    }
    const req = (item.entry_requirement || 'KCSE').toUpperCase();
    if (!VALID_ENTRY_REQS.includes(req)) {
      return { error: `Invalid entry_requirement "${req}". Must be one of: ${VALID_ENTRY_REQS.join(', ')}` };
    }
    let minKcseGrade = item.min_kcse_grade || null;
    if (minKcseGrade && !VALID_KCSE_GRADES.includes(minKcseGrade)) {
      return { error: `Invalid min_kcse_grade "${minKcseGrade}". Must be one of: ${VALID_KCSE_GRADES.join(', ')}` };
    }
    const minKcpeMarks = item.min_kcpe_marks != null ? Number(item.min_kcpe_marks) : null;

    normalised.push({
      name: item.name.trim(),
      entry_requirement: req,
      min_kcse_grade: req === 'KCSE' ? (minKcseGrade || null) : null,
      min_kcpe_marks: req === 'KCPE' ? (minKcpeMarks || null) : null,
    });
  }
  return { normalised };
}

/** Attach parsed levels array to each course object */
function hydrateCourse(course) {
  return {
    ...course,
    levels: parseLevels(course.levels),
  };
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------

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
      courses: courses.map(hydrateCourse),
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

    const { normalised, error } = normaliseLevels(levels);
    if (error) return res.status(400).json({ error });

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
        levels: JSON.stringify(normalised),
        shortcode: cleanShortcode,
        department_id,
      },
    });

    res.status(201).json(hydrateCourse(course));
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

    let normalisedLevels;
    if (levels !== undefined) {
      const result = normaliseLevels(levels);
      if (result.error) return res.status(400).json({ error: result.error });
      normalisedLevels = result.normalised;
    }

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
        levels: normalisedLevels ? JSON.stringify(normalisedLevels) : course.levels,
        shortcode: cleanShortcode || course.shortcode,
        department_id: department_id || course.department_id,
      },
    });

    res.json(hydrateCourse(updated));
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
  parseLevels,       // exported for use in other controllers
  hydrateCourse,     // exported for use in other controllers
};

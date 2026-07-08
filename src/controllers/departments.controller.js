const prisma = require('../config/db');

const getDepartments = async (req, res) => {
  try {
    const departments = await prisma.department.findMany({
      include: {
        courses: true,
        head: { select: { id: true, email: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(departments);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getDepartmentBySlug = async (req, res) => {
  try {
    const dept = await prisma.department.findUnique({
      where: { slug: req.params.slug },
      include: { courses: true, head: { select: { id: true, email: true } } },
    });
    if (!dept) return res.status(404).json({ error: 'Department not found' });
    res.json(dept);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getCoursesByDepartment = async (req, res) => {
  try {
    const dept = await prisma.department.findUnique({
      where: { slug: req.params.slug },
    });
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    const courses = await prisma.course.findMany({
      where: { department_id: dept.id },
      orderBy: { name: 'asc' },
    });
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

const getAllCourses = async (req, res) => {
  try {
    const courses = await prisma.course.findMany({
      include: { department: { select: { id: true, name: true, slug: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(courses);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

const slugify = (text) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
};

const createDepartment = async (req, res) => {
  try {
    const { name, tagline, description, icon, image_url, head_user_id, shortcode, intake_months } = req.body;
    if (!name) return res.status(400).json({ error: 'Department name is required' });
    if (!shortcode) return res.status(400).json({ error: 'Department shortcode is required (e.g., ECS, CEE, DSW)' });

    const slug = slugify(name);

    const existing = await prisma.department.findFirst({
      where: { OR: [{ name }, { slug }, { shortcode }] }
    });
    if (existing) {
      return res.status(400).json({ error: 'A department with this name or shortcode already exists' });
    }

    const dept = await prisma.department.create({
      data: {
        name,
        slug,
        tagline: tagline || null,
        description: description || null,
        icon: icon || null,
        image_url: image_url || null,
        head_user_id: head_user_id || null,
        shortcode: shortcode.toUpperCase(),
        intake_months: intake_months || 'J,M,S',
      }
    });

    res.status(201).json(dept);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, tagline, description, icon, image_url, head_user_id, shortcode, intake_months } = req.body;

    const existingDept = await prisma.department.findUnique({ where: { id } });
    if (!existingDept) return res.status(404).json({ error: 'Department not found' });

    let slug = existingDept.slug;
    if (name && name !== existingDept.name) {
      slug = slugify(name);
      const duplicate = await prisma.department.findFirst({
        where: { slug, id: { not: id } }
      });
      if (duplicate) {
        return res.status(400).json({ error: 'A department with this name already exists' });
      }
    }

    // Check shortcode uniqueness if being updated
    if (shortcode && shortcode !== existingDept.shortcode) {
      const duplicateShortcode = await prisma.department.findFirst({
        where: { shortcode: shortcode.toUpperCase(), id: { not: id } }
      });
      if (duplicateShortcode) {
        return res.status(400).json({ error: 'A department with this shortcode already exists' });
      }
    }

    const updated = await prisma.department.update({
      where: { id },
      data: {
        ...(name && { name, slug }),
        tagline: tagline !== undefined ? tagline : existingDept.tagline,
        description: description !== undefined ? description : existingDept.description,
        icon: icon !== undefined ? icon : existingDept.icon,
        image_url: image_url !== undefined ? image_url : existingDept.image_url,
        head_user_id: head_user_id !== undefined ? head_user_id : existingDept.head_user_id,
        shortcode: shortcode ? shortcode.toUpperCase() : existingDept.shortcode,
        intake_months: intake_months !== undefined ? intake_months : existingDept.intake_months,
      }
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

const deleteDepartment = async (req, res) => {
  try {
    const { id } = req.params;

    const dept = await prisma.department.findUnique({
      where: { id },
      include: {
        _count: {
          select: { courses: true, students: true, applications: true }
        }
      }
    });
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    if (dept._count.courses > 0 || dept._count.students > 0 || dept._count.applications > 0) {
      return res.status(400).json({
        error: 'Cannot delete department: it has associated courses, students, or applications'
      });
    }

    await prisma.department.delete({ where: { id } });
    res.json({ message: 'Department deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getDepartments,
  getDepartmentBySlug,
  getCoursesByDepartment,
  getAllCourses,
  createDepartment,
  updateDepartment,
  deleteDepartment
};

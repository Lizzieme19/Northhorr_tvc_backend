const prisma = require('../config/db');
const { uploadDocuments } = require('../middleware/upload');
const csv = require('csv-parser');
const { Readable } = require('stream');
const { v4: uuidv4 } = require('uuid');

// Generate unique application number
const generateAppNo = () => {
  const year = new Date().getFullYear();
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `NTVC/APP/${year}/${rand}`;
};

// POST /api/applications — public walk-in submission
const submitApplication = async (req, res) => {
  try {
    const body = req.body;

    // Upload documents to B2
    let docUrls = {};
    if (req.files && Object.keys(req.files).length > 0) {
      const uploaded = await uploadDocuments(req.files, 'documents');
      for (const [key, val] of Object.entries(uploaded)) {
        docUrls[key] = val.url;
      }
    }

    // Validate required fields
    if (!body.surname || !body.other_names || !body.gender || !body.date_of_birth || !body.email || !body.phone) {
      return res.status(400).json({ error: 'Missing required personal details' });
    }

    const application = await prisma.application.create({
      data: {
        application_no: generateAppNo(),
        type: 'DIRECT',
        surname: body.surname,
        other_names: body.other_names,
        gender: body.gender,
        date_of_birth: new Date(body.date_of_birth),
        nationality: body.nationality || 'Kenyan',
        religion: body.religion || null,
        id_number: body.id_number || null,
        birth_cert_no: body.birth_cert_no || null,
        email: body.email,
        phone: body.phone,
        address: body.address || null,
        kcpe_index: body.kcpe_index || null,
        kcpe_marks: body.kcpe_marks ? parseInt(body.kcpe_marks) : null,
        kcse_index: body.kcse_index || null,
        kcse_grade: body.kcse_grade || null,
        previous_school: body.previous_school || null,
        parent_names: body.parent_names || null,
        parent_relationship: body.parent_relationship || null,
        parent_phone: body.parent_phone || null,
        parent_email: body.parent_email || null,
        medical_conditions: body.medical_conditions || null,
        allergies: body.allergies || null,
        disability: body.disability || null,
        emergency_person: body.emergency_person || null,
        emergency_phone: body.emergency_phone || null,
        course_id: body.course_id || null,
        department_id: body.department_id || null,
        level_applied: body.level_applied || null,
        doc_kcpe: docUrls.doc_kcpe || null,
        doc_kcse: docUrls.doc_kcse || null,
        doc_id_copy: docUrls.doc_id_copy || null,
        doc_birth_cert: docUrls.doc_birth_cert || null,
        doc_medical: docUrls.doc_medical || null,
      },
    });

    res.status(201).json({
      message: 'Application submitted successfully',
      application_no: application.application_no,
      id: application.id,
    });
  } catch (err) {
    console.error('Application submission error:', err);
    res.status(500).json({ error: 'Failed to submit application' });
  }
};

// GET /api/applications — Admin/Dept Head
const getApplications = async (req, res) => {
  try {
    const { status, department_id, type, page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (type) where.type = type;

    // Dept head can only see their department
    if (req.user.role === 'DEPT_HEAD') {
      const dept = await prisma.department.findFirst({ where: { head_user_id: req.user.id } });
      if (dept) where.department_id = dept.id;
    } else if (department_id) {
      where.department_id = department_id;
    }

    if (search) {
      where.OR = [
        { surname: { contains: search, mode: 'insensitive' } },
        { other_names: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { application_no: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where,
        include: {
          course: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
          reviewer: { select: { id: true, email: true } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.application.count({ where }),
    ]);

    res.json({
      applications,
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

// GET /api/applications/:id
const getApplicationById = async (req, res) => {
  try {
    const app = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        course: true,
        department: true,
        reviewer: { select: { id: true, email: true } },
        student: { select: { id: true, admission_no: true } },
      },
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });
    res.json(app);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/applications/:id/status — Admin approve/reject
const updateApplicationStatus = async (req, res) => {
  try {
    const { status, review_notes, intake, year } = req.body;
    const validStatuses = ['UNDER_REVIEW', 'APPROVED', 'REJECTED'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
    });
    if (!application) return res.status(404).json({ error: 'Application not found' });

    const updated = await prisma.application.update({
      where: { id: req.params.id },
      data: {
        status,
        reviewed_by: req.user.id,
        reviewed_at: new Date(),
        review_notes: review_notes || null,
      },
    });

    // If approved — auto-create student account
    if (status === 'APPROVED' && !application.student) {
      const bcrypt = require('bcryptjs');
      const email = application.email;
      const tempPassword = `NTVC@${new Date().getFullYear()}`;
      const hashed = await bcrypt.hash(tempPassword, 12);

      // Create user account
      let user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        user = await prisma.user.create({
          data: { email, password: hashed, role: 'STUDENT' },
        });
      }

      // Determine intake and year
      const intakeMap = { JANUARY: 'JANUARY', MAY: 'MAY', SEPTEMBER: 'SEPTEMBER' };
      const studentIntake = intakeMap[intake] || 'SEPTEMBER';
      const studentYear = parseInt(year) || new Date().getFullYear();

      // Find course to get the shortcode
      let shortcode = 'GEN';
      if (application.course_id) {
        const course = await prisma.course.findUnique({
          where: { id: application.course_id }
        });
        if (course && course.shortcode) {
          shortcode = course.shortcode.toUpperCase();
        }
      }

      // Map level (e.g. "Level 3" -> "L3")
      const levelStr = application.level_applied || 'Level 4';
      const levelMatch = levelStr.match(/\d+/);
      const levelCode = levelMatch ? `L${levelMatch[0]}` : 'L4';

      // Map intake (JANUARY -> J, MAY -> M, SEPTEMBER -> S)
      const firstLetter = studentIntake.charAt(0).toUpperCase();
      const intakeCode = ['J', 'M', 'S'].includes(firstLetter) ? firstLetter : 'S';

      // Count cohort students to get incremental index
      const cohortCount = await prisma.student.count({
        where: {
          course_id: application.course_id || '',
          level: levelStr,
          intake: studentIntake,
          year: studentYear,
        }
      });
      const incrementalCode = String(cohortCount + 1).padStart(3, '0');

      // Generate final admission number: Shortcode/Level/Incremental/IntakeYear
      const admissionNo = `${shortcode}/${levelCode}/${incrementalCode}/${intakeCode}${studentYear}`;

      await prisma.student.create({
        data: {
          admission_no: admissionNo,
          user_id: user.id,
          application_id: application.id,
          course_id: application.course_id || uuidv4(), // fallback
          department_id: application.department_id || uuidv4(),
          level: levelStr,
          intake: studentIntake,
          year: studentYear,
          status: 'ACTIVE',
        },
      });

      return res.json({
        message: 'Application approved. Student account created.',
        application: updated,
        student_credentials: {
          email,
          temporary_password: tempPassword,
          note: 'Student should change password on first login',
        },
      });
    }

    res.json({ message: `Application ${status.toLowerCase()}`, application: updated });
  } catch (err) {
    console.error('Status update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/applications/import/kuccps — CSV upload
const importKuccps = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }

    const results = [];
    const errors = [];

    const stream = Readable.from(req.file.buffer.toString());
    await new Promise((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (row) => results.push(row))
        .on('end', resolve)
        .on('error', reject);
    });

    const created = [];
    for (const row of results) {
      try {
        const app = await prisma.application.create({
          data: {
            application_no: generateAppNo(),
            type: 'KUCCPS',
            surname: row.surname || row.Surname || '',
            other_names: row.other_names || row['Other Names'] || '',
            gender: row.gender || row.Gender || '',
            date_of_birth: new Date(row.dob || row.DOB || '2000-01-01'),
            email: row.email || row.Email || `${uuidv4()}@placeholder.ntvc.ac.ke`,
            phone: row.phone || row.Phone || '',
            kcse_index: row.kcse_index || row['KCSE Index'] || null,
            kcse_grade: row.kcse_grade || row['KCSE Grade'] || null,
            status: 'APPROVED',
          },
        });
        created.push(app.application_no);
      } catch (e) {
        errors.push({ row, error: e.message });
      }
    }

    res.json({
      message: `KUCCPS import complete`,
      imported: created.length,
      errors: errors.length,
      error_details: errors,
    });
  } catch (err) {
    console.error('KUCCPS import error:', err);
    res.status(500).json({ error: 'Import failed' });
  }
};

// GET /api/applications/my — Student views their own application
const getMyApplication = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { user_id: req.user.id },
      include: { application: true },
    });
    if (!student) return res.status(404).json({ error: 'No application found' });
    res.json(student.application);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  submitApplication,
  getApplications,
  getApplicationById,
  updateApplicationStatus,
  importKuccps,
  getMyApplication,
};

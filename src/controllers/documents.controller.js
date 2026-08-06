const prisma = require('../config/db');
const {
  generateLetterOfAcceptance,
  generateAdmissionForTraining,
  generateFeeStructure,
  generateStudentPersonalInfo,
} = require('../utils/documentGenerator');

/**
 * GET /api/students/:id/documents/letter-of-acceptance
 * Generate Letter of Acceptance document
 */
const getLetterOfAcceptance = async (req, res) => {
  try {
    const { id } = req.params;

    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        course: {
          include: {
            department: true,
          },
        },
        department: true,
      },
    });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const docBuffer = generateLetterOfAcceptance(student);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Letter_of_Acceptance_${student.admission_no}.docx"`);
    res.send(docBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate document' });
  }
};

/**
 * GET /api/students/:id/documents/admission-for-training
 * Generate Admission for Training document
 */
const getAdmissionForTraining = async (req, res) => {
  try {
    const { id } = req.params;

    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        course: {
          include: {
            department: true,
          },
        },
        department: true,
      },
    });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const docBuffer = generateAdmissionForTraining(student);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Admission_for_Training_${student.admission_no}.docx"`);
    res.send(docBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate document' });
  }
};

/**
 * GET /api/students/:id/documents/fee-structure
 * Generate Fee Structure document
 */
const getFeeStructure = async (req, res) => {
  try {
    const { id } = req.params;

    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        course: {
          include: {
            department: true,
          },
        },
        department: true,
        feeRecords: {
          orderBy: { created_at: 'desc' },
          take: 1,
        },
      },
    });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Add fee data if available
    if (student.feeRecords.length > 0) {
      student.total_fees = student.feeRecords[0].total_fees;
      student.academic_year = student.feeRecords[0].academic_year;
      student.semester = student.feeRecords[0].semester;
    }

    const docBuffer = generateFeeStructure(student);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Fee_Structure_${student.admission_no}.docx"`);
    res.send(docBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate document' });
  }
};

/**
 * GET /api/students/:id/documents/personal-information
 * Generate Student Personal Information document
 */
const getStudentPersonalInfo = async (req, res) => {
  try {
    const { id } = req.params;

    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        course: {
          include: {
            department: true,
          },
        },
        department: true,
      },
    });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const docBuffer = generateStudentPersonalInfo(student);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="Student_Personal_Information_${student.admission_no}.docx"`);
    res.send(docBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate document' });
  }
};

module.exports = {
  getLetterOfAcceptance,
  getAdmissionForTraining,
  getFeeStructure,
  getStudentPersonalInfo,
};

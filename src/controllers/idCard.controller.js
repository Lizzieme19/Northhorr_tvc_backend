const { generateIDCard } = require('../utils/idCardGenerator');
const prisma = require('../config/db');

/**
 * GET /api/students/:studentId/id-card
 * Generate and serve student ID card as PNG
 */
const getStudentIDCard = async (req, res) => {
  try {
    const { studentId } = req.params;

    // Validate student exists
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        admission_no: true,
        profile_picture_url: true,
        id_card_expiry_date: true,
        status: true,
      },
    });

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Check if student has profile picture
    if (!student.profile_picture_url) {
      return res.status(400).json({ 
        error: 'Student must upload a profile picture before generating ID card' 
      });
    }

    // Check if student is active
    if (student.status !== 'ACTIVE') {
      return res.status(400).json({ 
        error: 'ID card can only be generated for active students' 
      });
    }

    // Generate ID card
    const pngBuffer = await generateIDCard(studentId);

    // Set response headers
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${student.admission_no}.png"`);
    
    res.send(pngBuffer);
  } catch (error) {
    console.error('ID card generation error:', error);
    res.status(500).json({ error: 'Failed to generate ID card' });
  }
};

/**
 * GET /api/students/me/id-card
 * Generate and serve current student's ID card (for student portal)
 */
const getMyIDCard = async (req, res) => {
  try {
    // Get student from authenticated user
    if (!req.user.student) {
      return res.status(400).json({ error: 'User is not a student' });
    }

    const studentId = req.user.student.id;
    console.log('ID Card request for student ID:', studentId);

    // Validate student exists and has profile picture
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        admission_no: true,
        profile_picture_url: true,
        id_card_expiry_date: true,
        status: true,
      },
    });

    if (!student) {
      console.error('Student not found with ID:', studentId);
      return res.status(404).json({ error: 'Student not found' });
    }

    if (!student.profile_picture_url) {
      return res.status(400).json({ 
        error: 'You must upload a profile picture before generating your ID card' 
      });
    }

    if (student.status !== 'ACTIVE') {
      return res.status(400).json({ 
        error: 'ID card can only be generated for active students' 
      });
    }

    // Generate ID card
    const pngBuffer = await generateIDCard(studentId);

    // Set response headers
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Disposition', `attachment; filename="${student.admission_no}.png"`);
    
    res.send(pngBuffer);
  } catch (error) {
    console.error('ID card generation error:', error);
    res.status(500).json({ error: 'Failed to generate ID card' });
  }
};

/**
 * PATCH /api/students/:studentId/id-card/expiry
 * Update student ID card expiry date (admin/finance only)
 */
const updateIDCardExpiry = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { expiry_date } = req.body;

    if (!expiry_date) {
      return res.status(400).json({ error: 'Expiry date is required' });
    }

    const expiryDate = new Date(expiry_date);
    if (isNaN(expiryDate.getTime())) {
      return res.status(400).json({ error: 'Invalid expiry date format' });
    }

    const student = await prisma.student.update({
      where: { id: studentId },
      data: { id_card_expiry_date: expiryDate },
      select: {
        id: true,
        admission_no: true,
        id_card_expiry_date: true,
      },
    });

    res.json(student);
  } catch (error) {
    console.error('Update ID card expiry error:', error);
    res.status(500).json({ error: 'Failed to update ID card expiry date' });
  }
};

module.exports = {
  getStudentIDCard,
  getMyIDCard,
  updateIDCardExpiry,
};

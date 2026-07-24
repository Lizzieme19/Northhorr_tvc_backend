const prisma = require('../config/db');
const { uploadToS3 } = require('../middleware/upload');
const { generateAdmissionNumber, getMonthShortcode } = require('../utils/admissionNumberGenerator');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');
const { createStudentBalance, canEnrollInTerm } = require('../utils/termHelper');

const studentIncludes = {
  user: { select: { id: true, email: true, role: true } },
  course: { select: { id: true, name: true, levels: true } },
  department: { select: { id: true, name: true, slug: true } },
  application: {
    select: {
      id: true, application_no: true, type: true, surname: true, other_names: true,
      gender: true, date_of_birth: true, phone: true, address: true,
      kcpe_marks: true, kcse_grade: true, status: true,
      parent_names: true, parent_relationship: true, parent_phone: true, parent_email: true,
      father_present: true, father_name: true, father_phone: true, father_email: true, father_occupation: true,
      mother_present: true, mother_name: true, mother_phone: true, mother_email: true, mother_occupation: true,
      emergency_person: true, emergency_phone: true,
    },
  },
  admission_letter: { select: { id: true, generated_at: true, letter_url: true } },
  fee_records: true,
};

// GET /api/students
const getStudents = async (req, res) => {
  try {
    const { department_id, status, intake, page = 1, limit = 20, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (status) where.status = status;
    if (intake) where.intake = intake;

    // Dept head sees only their dept
    if (req.user.role === 'DEPT_HEAD') {
      const dept = await prisma.department.findFirst({ where: { head_user_id: req.user.id } });
      if (dept) where.department_id = dept.id;
    } else if (department_id) {
      where.department_id = department_id;
    }

    if (search) {
      where.OR = [
        { admission_no: { contains: search, mode: 'insensitive' } },
        { application: { surname: { contains: search, mode: 'insensitive' } } },
        { application: { other_names: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: studentIncludes,
        orderBy: { created_at: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.student.count({ where }),
    ]);

    res.json({
      students,
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

// GET /api/students/stats
const getStudentStats = async (req, res) => {
  try {
    const [total, active, graduated, withdrawn, pendingApps, approvedApps] = await Promise.all([
      prisma.student.count(),
      prisma.student.count({ where: { status: 'ACTIVE' } }),
      prisma.student.count({ where: { status: 'GRADUATED' } }),
      prisma.student.count({ where: { status: 'WITHDRAWN' } }),
      prisma.application.count({ where: { status: 'PENDING' } }),
      prisma.application.count({ where: { status: 'APPROVED' } }),
    ]);

    const byDepartment = await prisma.student.groupBy({
      by: ['department_id'],
      _count: { _all: true },
    });

    res.json({ total, active, graduated, withdrawn, pendingApps, approvedApps, byDepartment });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/students/me
const getMyProfile = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { user_id: req.user.id },
      include: studentIncludes,
    });
    if (!student) return res.status(404).json({ error: 'Student profile not found' });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/students/:id
const getStudentById = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      include: studentIncludes,
    });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Students can only view their own profile
    if (req.user.role === 'STUDENT' && student.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(student);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/students/:id
const updateStudent = async (req, res) => {
  try {
    const { level, intake, year, status, helb_applied, course_id, department_id,
          profile_picture_url, id_copy_front_url, id_copy_back_url,
          parent_id_copy_front_url, parent_id_copy_back_url,
          // Parent information
          father_present, father_name, father_phone, father_email, father_occupation,
          mother_present, mother_name, mother_phone, mother_email, mother_occupation,
          parent_names, parent_relationship, parent_phone, parent_email,
          emergency_person, emergency_phone } = req.body;

    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      include: { department: true, application: true },
    });

    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Department heads can only update students in their department
    if (req.user.role === 'DEPT_HEAD') {
      const dept = await prisma.department.findFirst({ where: { head_user_id: req.user.id } });
      if (!dept || dept.id !== student.department_id) {
        return res.status(403).json({ error: 'Access denied. You can only update students in your department.' });
      }
    }

    const updated = await prisma.student.update({
      where: { id: req.params.id },
      data: {
        ...(level && { level }),
        ...(intake && { intake }),
        ...(year && { year: parseInt(year) }),
        ...(status && { status }),
        ...(helb_applied !== undefined && { helb_applied }),
        ...(course_id && { course_id }),
        ...(department_id && { department_id }),
        ...(profile_picture_url && { profile_picture_url }),
        ...(id_copy_front_url !== undefined && { id_copy_front_url }),
        ...(id_copy_back_url !== undefined && { id_copy_back_url }),
        ...(parent_id_copy_front_url !== undefined && { parent_id_copy_front_url }),
        ...(parent_id_copy_back_url !== undefined && { parent_id_copy_back_url }),
      },
      include: studentIncludes,
    });

    // Update application fields if provided
    if (student.application) {
      await prisma.application.update({
        where: { id: student.application.id },
        data: {
          ...(father_present !== undefined && { father_present }),
          ...(father_name !== undefined && { father_name }),
          ...(father_phone !== undefined && { father_phone }),
          ...(father_email !== undefined && { father_email }),
          ...(father_occupation !== undefined && { father_occupation }),
          ...(mother_present !== undefined && { mother_present }),
          ...(mother_name !== undefined && { mother_name }),
          ...(mother_phone !== undefined && { mother_phone }),
          ...(mother_email !== undefined && { mother_email }),
          ...(mother_occupation !== undefined && { mother_occupation }),
          ...(parent_names !== undefined && { parent_names }),
          ...(parent_relationship !== undefined && { parent_relationship }),
          ...(parent_phone !== undefined && { parent_phone }),
          ...(parent_email !== undefined && { parent_email }),
          ...(emergency_person !== undefined && { emergency_person }),
          ...(emergency_phone !== undefined && { emergency_phone }),
        },
      });
    }

    res.json(updated);
  } catch (err) {
    console.error('Update student error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/students/:id/documents - Upload student documents (Admin only)
const uploadStudentDocuments = async (req, res) => {
  try {
    const { 
      id_copy_front, 
      id_copy_back, 
      parent_id_copy_front, 
      parent_id_copy_back,
      kcse_certificate,
      birth_certificate,
      other_documents
    } = req.files || {};
    
    // Students can only upload their own documents, admins can upload any
    const student = await prisma.student.findUnique({ where: { id: req.params.id } });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    if (req.user.role === 'STUDENT' && student.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updateData = {};

    if (id_copy_front) {
      const { url } = await uploadToS3(id_copy_front[0].buffer, id_copy_front[0].originalname, 'documents');
      updateData.id_copy_front_url = url;
    }

    if (id_copy_back) {
      const { url } = await uploadToS3(id_copy_back[0].buffer, id_copy_back[0].originalname, 'documents');
      updateData.id_copy_back_url = url;
    }

    if (parent_id_copy_front) {
      const { url } = await uploadToS3(parent_id_copy_front[0].buffer, parent_id_copy_front[0].originalname, 'documents');
      updateData.parent_id_copy_front_url = url;
    }

    if (parent_id_copy_back) {
      const { url } = await uploadToS3(parent_id_copy_back[0].buffer, parent_id_copy_back[0].originalname, 'documents');
      updateData.parent_id_copy_back_url = url;
    }

    if (kcse_certificate) {
      const { url } = await uploadToS3(kcse_certificate[0].buffer, kcse_certificate[0].originalname, 'documents');
      updateData.kcse_certificate_url = url;
    }

    if (birth_certificate) {
      const { url } = await uploadToS3(birth_certificate[0].buffer, birth_certificate[0].originalname, 'documents');
      updateData.birth_certificate_url = url;
    }

    if (other_documents) {
      const { url } = await uploadToS3(other_documents[0].buffer, other_documents[0].originalname, 'documents');
      updateData.other_documents_url = url;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'At least one document file is required' });
    }

    const updated = await prisma.student.update({
      where: { id: req.params.id },
      data: updateData,
      select: { 
        id: true, 
        admission_no: true, 
        id_copy_front_url: true,
        id_copy_back_url: true,
        parent_id_copy_front_url: true,
        parent_id_copy_back_url: true,
      },
    });

    res.json({ message: 'Documents uploaded successfully', student: updated });
  } catch (err) {
    console.error('Document upload error:', err);
    res.status(500).json({ error: 'Failed to upload documents' });
  }
};

// POST /api/students/:id/photo
const uploadPhoto = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Photo file is required' });

    // Students can only upload their own photo, admins can upload any
    const student = await prisma.student.findUnique({ where: { id: req.params.id } });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    if (req.user.role === 'STUDENT' && student.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { url } = await uploadToS3(req.file.buffer, req.file.originalname, 'photos');

    const updated = await prisma.student.update({
      where: { id: req.params.id },
      data: { profile_picture_url: url },
      select: { id: true, admission_no: true, profile_picture_url: true },
    });

    res.json({ message: 'Profile picture uploaded successfully', student: updated });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
};

// PATCH /api/students/me/profile-picture - Student self-service profile picture upload
const uploadMyProfilePicture = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Profile picture file is required' });

    const student = await prisma.student.findUnique({ where: { user_id: req.user.id } });
    if (!student) return res.status(404).json({ error: 'Student profile not found' });

    const { url } = await uploadToS3(req.file.buffer, req.file.originalname, 'profile-pictures');

    const updated = await prisma.student.update({
      where: { user_id: req.user.id },
      data: { profile_picture_url: url },
      select: { id: true, admission_no: true, profile_picture_url: true },
    });

    res.json({ message: 'Profile picture uploaded successfully', student: updated });
  } catch (err) {
    console.error('Profile picture upload error:', err);
    res.status(500).json({ error: 'Failed to upload profile picture' });
  }
};

// GET /api/students/:id/id-card - Generate student ID card PDF
const generateIdCard = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { email: true } },
        application: {
          select: {
            surname: true,
            other_names: true,
            gender: true,
            id_number: true,
            date_of_birth: true,
          },
        },
        course: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Access control
    if (req.user.role === 'STUDENT' && student.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Create PDF document
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('NORTH HORR TECHNICAL & VOCATIONAL COLLEGE', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text('Student Identification Card', { align: 'center' });
    doc.moveDown();

    // Border
    doc.rect(40, 40, 515, 700).stroke();

    // Student photo placeholder (if profile picture exists, it would be loaded here)
    if (student.profile_picture_url) {
      doc.image(student.profile_picture_url, 60, 120, { width: 150, height: 150 });
    } else {
      doc.rect(60, 120, 150, 150).stroke();
      doc.fontSize(10).text('PHOTO', 105, 190, { align: 'center' });
    }

    // Student details
    const fullName = `${student.application.surname} ${student.application.other_names}`;
    doc.fontSize(14).font('Helvetica-Bold').text('Name:', 240, 120);
    doc.fontSize(12).font('Helvetica').text(fullName, 240, 140);

    doc.fontSize(14).font('Helvetica-Bold').text('Admission No:', 240, 170);
    doc.fontSize(12).font('Helvetica').text(student.admission_no, 240, 190);

    doc.fontSize(14).font('Helvetica-Bold').text('Department:', 240, 220);
    doc.fontSize(12).font('Helvetica').text(student.department.name, 240, 240);

    doc.fontSize(14).font('Helvetica-Bold').text('Course:', 240, 270);
    doc.fontSize(12).font('Helvetica').text(student.course.name, 240, 290);

    doc.fontSize(14).font('Helvetica-Bold').text('Gender:', 240, 320);
    doc.fontSize(12).font('Helvetica').text(student.application.gender, 240, 340);

    doc.fontSize(14).font('Helvetica-Bold').text('ID Number:', 240, 370);
    doc.fontSize(12).font('Helvetica').text(student.application.id_number || 'N/A', 240, 390);

    doc.fontSize(14).font('Helvetica-Bold').text('Level:', 240, 420);
    doc.fontSize(12).font('Helvetica').text(student.level, 240, 440);

    doc.fontSize(14).font('Helvetica-Bold').text('Intake:', 240, 470);
    doc.fontSize(12).font('Helvetica').text(`${student.intake} ${student.year}`, 240, 490);

    // Expiry date (2 years from admission)
    const expiryDate = new Date(student.year, 11, 31); // December of year + 2
    expiryDate.setFullYear(expiryDate.getFullYear() + 2);
    doc.fontSize(14).font('Helvetica-Bold').text('Valid Until:', 240, 520);
    doc.fontSize(12).font('Helvetica').text(expiryDate.toLocaleDateString(), 240, 540);

    // Footer
    doc.fontSize(10).font('Helvetica').text('This card is the property of North Horr Technical & Vocational College.', 50, 680, { align: 'center' });
    doc.fontSize(10).font('Helvetica').text('If found, please return to the college administration.', 50, 695, { align: 'center' });

    doc.end();

    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${student.admission_no}_id_card.pdf"`);
      res.send(pdfBuffer);
    });
  } catch (err) {
    console.error('ID card generation error:', err);
    res.status(500).json({ error: 'Failed to generate ID card' });
  }
};

// PATCH /api/students/me - Student update their own profile
const updateMyProfile = async (req, res) => {
  try {
    const { phone, address, id_number, emergency_contact_name, emergency_contact_phone,
          profile_picture_url, id_copy_front_url, id_copy_back_url,
          parent_id_copy_front_url, parent_id_copy_back_url } = req.body;

    const student = await prisma.student.findUnique({
      where: { user_id: req.user.id },
      include: { application: true },
    });

    if (!student) return res.status(404).json({ error: 'Student profile not found' });

    const updated = await prisma.student.update({
      where: { user_id: req.user.id },
      data: {
        ...(profile_picture_url && { profile_picture_url }),
        ...(id_copy_front_url !== undefined && { id_copy_front_url }),
        ...(id_copy_back_url !== undefined && { id_copy_back_url }),
        ...(parent_id_copy_front_url !== undefined && { parent_id_copy_front_url }),
        ...(parent_id_copy_back_url !== undefined && { parent_id_copy_back_url }),
      },
      include: studentIncludes,
    });

    if (student.application) {
      await prisma.application.update({
        where: { id: student.application.id },
        data: {
          ...(phone && { phone }),
          ...(address && { address }),
          ...(id_number && { id_number }),
          ...(emergency_contact_name && { emergency_contact_name }),
          ...(emergency_contact_phone && { emergency_contact_phone }),
        },
      });
    }

    res.json(updated);
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/students/documents/:type - Generate prefilled document
const generatePrefilledDocument = async (req, res) => {
  try {
    const { type } = req.params;
    const student = await prisma.student.findUnique({
      where: { user_id: req.user.id },
      include: {
        application: true,
        course: true,
        department: true,
      },
    });

    if (!student) return res.status(404).json({ error: 'Student profile not found' });

    let doc;
    const fullName = `${student.application.surname} ${student.application.other_names}`;

    if (type === 'admission_form') {
      doc = new Document({
        sections: [{
          properties: {},
          children: [
            new Paragraph({
              text: 'NORTH HORR TECHNICAL & VOCATIONAL COLLEGE',
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
            }),
            new Paragraph({
              text: 'ADMISSION FOR TRAINING FORM',
              heading: HeadingLevel.HEADING_2,
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
            }),
            new Paragraph({ text: 'Personal Information', heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 200 } }),
            new Paragraph({ text: `Full Name: ${fullName}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Date of Birth: ${student.application.date_of_birth ? new Date(student.application.date_of_birth).toLocaleDateString() : 'N/A'}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Gender: ${student.application.gender || 'N/A'}`, spacing: { after: 100 } }),
            new Paragraph({ text: `ID Number: ${student.application.id_number || 'N/A'}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Phone: ${student.application.phone || 'N/A'}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Address: ${student.application.address || 'N/A'}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Emergency Contact: ${student.application.emergency_person || 'N/A'}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Emergency Phone: ${student.application.emergency_phone || 'N/A'}`, spacing: { after: 100 } }),
            new Paragraph({ text: 'Course Information', heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 200 } }),
            new Paragraph({ text: `Admission Number: ${student.admission_no}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Course: ${student.course.name}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Department: ${student.department.name}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Level: ${student.level}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Intake: ${student.intake} ${student.year}`, spacing: { after: 100 } }),
          ],
        }],
      });
    } else if (type === 'medical_form') {
      doc = new Document({
        sections: [{
          properties: {},
          children: [
            new Paragraph({
              text: 'NORTH HORR TECHNICAL & VOCATIONAL COLLEGE',
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
            }),
            new Paragraph({
              text: 'STUDENTS ENTRANCE MEDICAL EXAMINATION FORM',
              heading: HeadingLevel.HEADING_2,
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
            }),
            new Paragraph({ text: 'Student Information', heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 200 } }),
            new Paragraph({ text: `Student Name: ${fullName}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Admission Number: ${student.admission_no}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Date of Birth: ${student.application.date_of_birth ? new Date(student.application.date_of_birth).toLocaleDateString() : 'N/A'}`, spacing: { after: 100 } }),
            new Paragraph({ text: `Gender: ${student.application.gender || 'N/A'}`, spacing: { after: 100 } }),
            new Paragraph({ text: 'Medical Information', heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 200 } }),
            new Paragraph({ text: 'Blood Group: _______________', spacing: { after: 100 } }),
            new Paragraph({ text: 'Any Chronic Illness: _______________', spacing: { after: 100 } }),
            new Paragraph({ text: 'Allergies: _______________', spacing: { after: 100 } }),
            new Paragraph({ text: 'Hospital/Facility Information', heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 200 } }),
            new Paragraph({ text: 'Hospital/Facility Name: _______________', spacing: { after: 100 } }),
            new Paragraph({ text: 'Doctor\'s Name: _______________', spacing: { after: 100 } }),
            new Paragraph({ text: 'Examination Date: _______________', spacing: { after: 100 } }),
            new Paragraph({ text: 'Doctor\'s Remarks:', spacing: { after: 100 } }),
            new Paragraph({ text: '_________________________________________________________________', spacing: { after: 100 } }),
            new Paragraph({ text: '_________________________________________________________________', spacing: { after: 100 } }),
            new Paragraph({ text: '_________________________________________________________________', spacing: { after: 300 } }),
            new Paragraph({ text: 'Doctor\'s Signature: _______________   Date: _______________', spacing: { after: 100 } }),
            new Paragraph({ text: 'Hospital Stamp: _______________', spacing: { after: 100 } }),
          ],
        }],
      });
    } else {
      return res.status(400).json({ error: 'Invalid document type' });
    }

    const buffer = await Packer.toBuffer(doc);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${type}_${student.admission_no}.docx"`);
    res.send(buffer);
  } catch (err) {
    console.error('Document generation error:', err);
    res.status(500).json({ error: 'Failed to generate document' });
  }
};

// POST /api/students/me/enroll/:termId - Student self-enrollment in a term
const enrollInTerm = async (req, res) => {
  try {
    const { termId } = req.params;
    
    const student = await prisma.student.findUnique({
      where: { user_id: req.user.id },
      include: { course: true }
    });

    if (!student) return res.status(404).json({ error: 'Student profile not found' });

    // Check if student can enroll
    const { canEnroll, reason } = await canEnrollInTerm(student.id, termId);
    if (!canEnroll) {
      return res.status(400).json({ error: reason });
    }

    // Get term details
    const term = await prisma.term.findUnique({
      where: { id: termId }
    });

    if (!term) return res.status(404).json({ error: 'Term not found' });

    // Create StudentBalance
    const balance = await createStudentBalance(student.id, termId, student.level);

    // Update student's current term
    await prisma.student.update({
      where: { id: student.id },
      data: { current_term_id: termId }
    });

    res.json({
      message: 'Successfully enrolled in term',
      term: term.name,
      balance: {
        total_fees: balance.total_fees,
        amount_paid: balance.amount_paid,
        balance: balance.balance,
        status: balance.status
      }
    });
  } catch (err) {
    console.error('Term enrollment error:', err);
    res.status(500).json({ error: 'Failed to enroll in term' });
  }
};

// GET /api/students/me/enrollments - Get student's term enrollments
const getMyEnrollments = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { user_id: req.user.id }
    });

    if (!student) return res.status(404).json({ error: 'Student profile not found' });

    const enrollments = await prisma.studentBalance.findMany({
      where: { student_id: student.id },
      include: {
        term: true
      },
      orderBy: {
        term: {
          start_date: 'desc'
        }
      }
    });

    res.json(enrollments);
  } catch (err) {
    console.error('Get enrollments error:', err);
    res.status(500).json({ error: 'Failed to fetch enrollments' });
  }
};

// POST /api/students/:id/term/:termId - Admin manual term assignment
const assignStudentTerm = async (req, res) => {
  try {
    const { id: studentId, termId } = req.params;
    
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { course: true }
    });

    if (!student) return res.status(404).json({ error: 'Student not found' });

    if (!student.course) return res.status(400).json({ error: 'Student has no course assigned' });

    const term = await prisma.term.findUnique({
      where: { id: termId }
    });

    if (!term) return res.status(404).json({ error: 'Term not found' });

    // Create or update StudentBalance
    const balance = await createStudentBalance(studentId, termId, student.level);

    // Update student's current term
    await prisma.student.update({
      where: { id: studentId },
      data: { current_term_id: termId }
    });

    res.json({
      message: 'Student term assigned successfully',
      student: student.admission_no,
      term: term.name,
      balance: {
        total_fees: balance.total_fees,
        amount_paid: balance.amount_paid,
        balance: balance.balance,
        status: balance.status
      }
    });
  } catch (err) {
    console.error('Term assignment error:', err);
    res.status(500).json({ error: 'Failed to assign term', details: err.message });
  }
};

// POST /api/students/bulk-assign-term - Bulk assign students to a term
const bulkAssignTerm = async (req, res) => {
  try {
    const { studentIds, termId } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'studentIds array is required' });
    }
    if (!termId) {
      return res.status(400).json({ error: 'termId is required' });
    }

    const term = await prisma.term.findUnique({
      where: { id: termId }
    });

    if (!term) return res.status(404).json({ error: 'Term not found' });

    const results = [];
    const errors = [];

    for (const studentId of studentIds) {
      try {
        const student = await prisma.student.findUnique({
          where: { id: studentId },
          include: { course: true }
        });

        if (!student) {
          errors.push({ studentId, error: 'Student not found' });
          continue;
        }

        if (!student.course) {
          errors.push({ studentId, admission_no: student.admission_no, error: 'Student has no course assigned' });
          continue;
        }

        // Create or update StudentBalance
        const balance = await createStudentBalance(studentId, termId, student.level);

        // Update student's current term
        await prisma.student.update({
          where: { id: studentId },
          data: { current_term_id: termId }
        });

        results.push({
          studentId,
          admission_no: student.admission_no,
          term: term.name,
          balance: {
            total_fees: balance.total_fees,
            amount_paid: balance.amount_paid,
            balance: balance.balance,
            status: balance.status
          }
        });
      } catch (err) {
        errors.push({ studentId, error: err.message });
      }
    }

    res.json({
      message: `Bulk term assignment completed`,
      summary: {
        total: studentIds.length,
        successful: results.length,
        failed: errors.length
      },
      results,
      errors
    });
  } catch (err) {
    console.error('Bulk term assignment error:', err);
    res.status(500).json({ error: 'Failed to perform bulk term assignment', details: err.message });
  }
};

module.exports = { getStudents, getStudentById, getMyProfile, updateStudent, updateMyProfile, uploadPhoto, uploadStudentDocuments, getStudentStats, uploadMyProfilePicture, generateIdCard, generatePrefilledDocument, enrollInTerm, getMyEnrollments, assignStudentTerm, bulkAssignTerm };

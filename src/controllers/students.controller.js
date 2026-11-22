const prisma = require('../config/db');
const { uploadToS3 } = require('../middleware/upload');
const { hasWhiteBackground, validateImage } = require('../utils/imageValidator');
const { generateAdmissionNumber, getMonthShortcode } = require('../utils/admissionNumberGenerator');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');
const fs = require('fs');
const path = require('path');
const { createStudentBalance, canEnrollInTerm } = require('../utils/termHelper');
const bcrypt = require('bcryptjs');
const { parsePaging, buildStudentWhere, resolveFeeFilterIds } = require('../utils/studentFilters');
const { mergeStudents } = require('./../services/studentProgressionService');

const studentIncludes = {
  user: { select: { id: true, email: true, role: true } },
  course: { select: { id: true, name: true, levels: true } },
  department: { select: { id: true, name: true, slug: true } },
  current_term: { select: { id: true, name: true, academic_year: true } },
  student_type: { select: { id: true, name: true } },
  // the login owner (when this is a linked admission) and the admissions linked under this one
  primary_student: { select: { id: true, admission_no: true } },
  linked_admissions: { select: { id: true, admission_no: true, level: true, status: true } },
  // the whole application record, so nothing the student gave (or the admin added) is left out when a student is pulled
  application: true,
  admission_letter: { select: { id: true, generated_at: true } },
  documents: { select: { document_type: true, generated_at: true } },
  fee_records: true,
};

// Registrars handle student affairs but not finance: strip payment data from what they receive
const { normalizeKenyaPhone, PHONE_HELP } = require('../utils/kenyaPhone');
const { checkChoices } = require('./profileOptions.controller');

const forRole = (student, role) => {
  if (role !== 'REGISTRAR' || !student) return student;
  const { fee_records, fee_adjustment, ...rest } = student;
  return rest;
};

// GET /api/students
// Query: page, limit, search, department_id, course_id, level, intake, year, status, gender, helb,
//        term_id, has_term, fee_status, outstanding_only
const getStudents = async (req, res) => {
  try {
    const { page, limit, skip } = parsePaging(req.query, { defaultLimit: 20 });
    const where = buildStudentWhere(req.query);

    // Dept head sees only their dept
    if (req.user.role === 'DEPT_HEAD') {
      const dept = await prisma.department.findFirst({ where: { head_user_id: req.user.id } });
      if (dept) where.department_id = dept.id;
    }

    // Fee-based filters are finance information
    if (req.user.role !== 'REGISTRAR') {
      const feeIds = await resolveFeeFilterIds(req.query);
      if (feeIds) where.id = { in: feeIds };
    }

    const [students, total] = await Promise.all([
      prisma.student.findMany({
        where,
        include: studentIncludes,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.student.count({ where }),
    ]);

    res.json({
      students: students.map((s) => forRole(s, req.user.role)),
      pagination: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

// GET /api/students/stats
const getStudentStats = async (req, res) => {
  try {
    // Linking two records of one person removes the older record, but that admission still happened: it stays in the
    // total enrolled. Each link leaves a LINKED entry in the history, so earlier merges are counted too.
    const [currentRecords, mergedRecords, active, graduated, withdrawn, pendingApps, approvedApps] = await Promise.all([
      prisma.student.count(),
      prisma.studentProgression.count({ where: { kind: 'LINKED' } }),
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

    const total = currentRecords + mergedRecords;
    res.json({ total, current_records: currentRecords, merged_records: mergedRecords, active, graduated, withdrawn, pendingApps, approvedApps, byDepartment });
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

    res.json(forRole(student, req.user.role));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/students/:id
const updateStudent = async (req, res) => {
  try {
    const { admission_no, level, intake, year, status, helb_applied, course_id, department_id,
          profile_picture_url, id_copy_front_url, id_copy_back_url,
          parent_id_copy_front_url, parent_id_copy_back_url,
          // Parent information
          father_present, father_name, father_phone, father_email, father_occupation,
          mother_present, mother_name, mother_phone, mother_email, mother_occupation,
          parent_names, parent_relationship, parent_phone, parent_email,
          emergency_person, emergency_phone,
          // Personal details (kept on the application record)
          surname, other_names, gender, date_of_birth, nationality, religion, id_number, birth_cert_no,
          phone, address, medical_conditions, allergies, father_deceased, mother_deceased, has_disability, disability } = req.body;

    const truthy = (v) => v === true || v === 'true';
    const clean = (v) => { const t = String(v ?? '').trim(); return t === '' ? null : t; };
    let dob;
    if (date_of_birth) {
      dob = new Date(date_of_birth);
      if (isNaN(dob.getTime())) return res.status(400).json({ error: 'Date of birth is not a valid date' });
    }

    const student = await prisma.student.findUnique({
      where: { id: req.params.id },
      include: { department: true, application: true },
    });

    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Kenyan mobile numbers only, kept as 07XXXXXXXX / 01XXXXXXXX. A number left as it already is (even an old
    // one in another format) is not rejected, so the rest of the form can still be saved.
    const goodPhones = {};
    const app0 = student.application || {};
    for (const [k, v] of Object.entries({ phone, emergency_phone, father_phone, mother_phone, parent_phone })) {
      if (v === undefined || v === null || String(v).trim() === '') continue;
      if (String(v).trim() === String(app0[k] ?? '').trim()) { goodPhones[k] = String(v).trim(); continue; }
      const n = normalizeKenyaPhone(v);
      if (!n) return res.status(400).json({ error: `${k.replace(/_/g, ' ')}: ${PHONE_HELP}`, fields: { [k]: PHONE_HELP } });
      goodPhones[k] = n;
    }

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
        ...(admission_no && { admission_no }),
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
          ...(goodPhones.emergency_phone && { emergency_phone: goodPhones.emergency_phone }),
          // phones that were sent empty are cleared; ones that were sent are the checked, tidied number
          ...(father_phone !== undefined && { father_phone: goodPhones.father_phone || null }),
          ...(mother_phone !== undefined && { mother_phone: goodPhones.mother_phone || null }),
          ...(parent_phone !== undefined && { parent_phone: goodPhones.parent_phone || null }),
          // personal details
          ...(surname !== undefined && clean(surname) && { surname: clean(surname) }),
          ...(other_names !== undefined && { other_names: String(other_names ?? '').trim() }),
          ...(gender !== undefined && clean(gender) && { gender: clean(gender) }),
          ...(dob && { date_of_birth: dob }),
          ...(nationality !== undefined && clean(nationality) && { nationality: clean(nationality) }),
          ...(religion !== undefined && { religion: clean(religion) }),
          ...(id_number !== undefined && { id_number: clean(id_number) }),
          ...(birth_cert_no !== undefined && { birth_cert_no: clean(birth_cert_no) }),
          ...(goodPhones.phone && { phone: goodPhones.phone }),
          ...(address !== undefined && { address: clean(address) }),
          ...(medical_conditions !== undefined && { medical_conditions: clean(medical_conditions) }),
          ...(allergies !== undefined && { allergies: clean(allergies) }),
          ...(father_deceased !== undefined && { father_deceased: truthy(father_deceased) }),
          ...(mother_deceased !== undefined && { mother_deceased: truthy(mother_deceased) }),
          ...(has_disability !== undefined && { has_disability: truthy(has_disability), disability: truthy(has_disability) ? clean(disability) || student.application.disability : null }),
        },
      });
    }

    const fresh = await prisma.student.findUnique({ where: { id: req.params.id }, include: studentIncludes });
    res.json(forRole(fresh || updated, req.user.role));
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

    res.json({ message: 'Documents uploaded successfully', student: forRole(updated, req.user.role) });
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

    // Validate image format and dimensions
    const imageValidation = await validateImage(req.file.buffer, {
      minWidth: 300,
      minHeight: 300,
      maxWidth: 5000,
      maxHeight: 5000,
      maxSizeMB: 5,
      formats: ['jpeg', 'png', 'jpg'],
    });

    if (!imageValidation.valid) {
      return res.status(400).json({ error: imageValidation.error });
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

    // Validate image format and dimensions
    const imageValidation = await validateImage(req.file.buffer, {
      minWidth: 300,
      minHeight: 300,
      maxWidth: 5000,
      maxHeight: 5000,
      maxSizeMB: 5,
      formats: ['jpeg', 'png', 'jpg'],
    });

    if (!imageValidation.valid) {
      return res.status(400).json({ error: imageValidation.error });
    }

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
    const {
      // Contact / identity
      phone, address, id_number, email,
      // Personal
      date_of_birth, gender, nationality, surname, other_names,
      // Emergency
      emergency_contact_name, emergency_contact_phone,
      // Documents (URL fields)
      profile_picture_url, id_copy_front_url, id_copy_back_url,
      parent_id_copy_front_url, parent_id_copy_back_url,
      // Parent / Guardian
      father_name, father_phone, father_email, father_occupation, father_present,
      mother_name, mother_phone, mother_email, mother_occupation, mother_present,
      parent_names, parent_phone, parent_email, parent_relationship,
      // Deceased parents and disability
      father_deceased, mother_deceased, has_disability, disability,
      // Religion: filled in by the student after admission, so it is open at any time
      religion,
      // Interests and sports (chosen from the lists the admin keeps; can be changed at any time)
      interests, sports,
    } = req.body;

    const student = await prisma.student.findUnique({
      where: { user_id: req.user.id },
      include: { application: true, user: true },
    });

    if (!student) return res.status(404).json({ error: 'Student profile not found' });

    // Kenyan mobile numbers only, kept as 07XXXXXXXX / 01XXXXXXXX
    const phoneFields = { phone, emergency_contact_phone, father_phone, mother_phone, parent_phone };
    const goodPhones = {};
    for (const [k, v] of Object.entries(phoneFields)) {
      if (v === undefined || v === null || String(v).trim() === '') continue;
      const n = normalizeKenyaPhone(v);
      if (!n) return res.status(400).json({ error: `${k.replace(/_/g, ' ')}: ${PHONE_HELP}`, fields: { [k]: PHONE_HELP } });
      goodPhones[k] = n;
    }
    let choices;
    try { choices = await checkChoices({ interests, sports }, { interests: student.interests, sports: student.sports }); }
    catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const truthy = (v) => v === true || v === 'true';
    if (has_disability !== undefined && truthy(has_disability) && !String(disability || student.application?.disability || '').trim()) {
      return res.status(400).json({ error: 'Please say what the disability is so the college can support you', fields: { disability: 'Describe the disability' } });
    }

    // ── Editing deadline — read from DB (admin can change without redeploy) ─
    const deadlineSetting = await prisma.systemSetting.findUnique({
      where: { key: 'student_edit_deadline' },
    });
    // Fallback: 30 Oct 2026 23:59 EAT if setting missing
    const deadlineISO = deadlineSetting?.value || '2026-10-30T20:59:59.000Z';
    const EDIT_DEADLINE = new Date(deadlineISO);
    const withinWindow = new Date() <= EDIT_DEADLINE;
    const windowEnd = EDIT_DEADLINE;

    // Detect if any restricted (personal/parent) fields were sent
    const restrictedRequested = [
      phone, address, id_number, date_of_birth, gender, nationality, surname,
      emergency_contact_name, emergency_contact_phone,
      id_copy_front_url, id_copy_back_url, parent_id_copy_front_url, parent_id_copy_back_url,
      father_name, father_phone, father_email, father_occupation, father_present,
      mother_name, mother_phone, mother_email, mother_occupation, mother_present,
      parent_names, parent_phone, parent_email, parent_relationship,
      father_deceased, mother_deceased, has_disability, disability,
    ].some(v => v !== undefined && v !== null) || other_names !== undefined;

    if (restrictedRequested && !withinWindow) {
      return res.status(403).json({
        error: 'Personal information editing deadline has passed.',
        detail: `The deadline to update personal and parent details was Friday, 30 October 2026. Only your profile photo and email can still be changed. Contact the registrar\'s office for any corrections.`,
        windowExpired: true,
        windowEnd: windowEnd.toISOString(),
      });
    }

    // ── Update User table (email) ─────────────────────────────────────────
    if (email) {
      const emailClean = String(email).trim().toLowerCase();
      // Validate basic email format
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) {
        return res.status(400).json({ error: 'Invalid email address format' });
      }
      // Check uniqueness — can't take another user's email
      const taken = await prisma.user.findUnique({ where: { email: emailClean } });
      if (taken && taken.id !== req.user.id) {
        return res.status(409).json({ error: 'That email address is already in use' });
      }
      await prisma.user.update({
        where: { id: req.user.id },
        data: { email: emailClean },
      });
      // Keep application email in sync
      if (student.application) {
        await prisma.application.update({
          where: { id: student.application.id },
          data: { email: emailClean },
        });
      }
    }

    // ── Update Student table ─────────────────────────────────────────────
    // ── Religion is not window-gated: it is no longer asked on the application form ──
    if (religion !== undefined && student.application) {
      const r = String(religion ?? '').trim();
      if (r.length > 60) return res.status(400).json({ error: 'Religion is too long' });
      await prisma.application.update({ where: { id: student.application.id }, data: { religion: r || null } });
    }

    const updated = await prisma.student.update({
      where: { user_id: req.user.id },
      data: {
        ...(profile_picture_url && { profile_picture_url }),
        ...(choices.interests !== undefined && { interests: choices.interests }),
        ...(choices.sports !== undefined && { sports: choices.sports }),
        ...(withinWindow && id_copy_front_url      !== undefined && { id_copy_front_url }),
        ...(withinWindow && id_copy_back_url       !== undefined && { id_copy_back_url }),
        ...(withinWindow && parent_id_copy_front_url !== undefined && { parent_id_copy_front_url }),
        ...(withinWindow && parent_id_copy_back_url  !== undefined && { parent_id_copy_back_url }),
      },
      include: studentIncludes,
    });

    // ── Update Application table (personal + parent – window-gated) ───────
    if (withinWindow && student.application) {
      const appData = {};
      if (phone)                    appData.phone             = goodPhones.phone;
      if (address)                  appData.address           = address;
      if (id_number)                appData.id_number         = id_number;
      if (gender)                   appData.gender            = gender;
      if (nationality)              appData.nationality       = nationality;
      if (surname)                  appData.surname           = surname;
      if (other_names !== undefined) appData.other_names      = other_names;
      if (emergency_contact_name)   appData.emergency_person  = emergency_contact_name;
      if (emergency_contact_phone)  appData.emergency_phone   = goodPhones.emergency_contact_phone;
      if (date_of_birth) {
        const parsed = new Date(date_of_birth);
        if (!isNaN(parsed.getTime())) appData.date_of_birth = parsed;
      }
      // Parent / Guardian fields
      if (father_name       !== undefined) appData.father_name        = father_name;
      if (father_phone      !== undefined) appData.father_phone       = goodPhones.father_phone || null;
      if (father_email      !== undefined) appData.father_email       = father_email;
      if (father_occupation !== undefined) appData.father_occupation  = father_occupation;
      if (father_present    !== undefined) appData.father_present     = father_present;
      if (mother_name       !== undefined) appData.mother_name        = mother_name;
      if (mother_phone      !== undefined) appData.mother_phone       = goodPhones.mother_phone || null;
      if (mother_email      !== undefined) appData.mother_email       = mother_email;
      if (mother_occupation !== undefined) appData.mother_occupation  = mother_occupation;
      if (mother_present    !== undefined) appData.mother_present     = mother_present;
      // Deceased parents have no details; disability
      if (father_deceased !== undefined) {
        appData.father_deceased = truthy(father_deceased);
        if (appData.father_deceased) Object.assign(appData, { father_present: false, father_name: null, father_phone: null, father_email: null, father_occupation: null });
      }
      if (mother_deceased !== undefined) {
        appData.mother_deceased = truthy(mother_deceased);
        if (appData.mother_deceased) Object.assign(appData, { mother_present: false, mother_name: null, mother_phone: null, mother_email: null, mother_occupation: null });
      }
      if (has_disability !== undefined) {
        appData.has_disability = truthy(has_disability);
        appData.disability = appData.has_disability ? String(disability || student.application?.disability || '').trim() : null;
      } else if (disability !== undefined && student.application?.has_disability) {
        appData.disability = String(disability).trim() || student.application.disability;
      }
      if (parent_names      !== undefined) appData.parent_names       = parent_names;
      if (parent_phone      !== undefined) appData.parent_phone       = goodPhones.parent_phone || null;
      if (parent_email      !== undefined) appData.parent_email       = parent_email;
      if (parent_relationship !== undefined) appData.parent_relationship = parent_relationship;

      if (Object.keys(appData).length) {
        await prisma.application.update({
          where: { id: student.application.id },
          data: appData,
        });
      }
    }

    res.json({
      message: 'Profile updated successfully',
      student: updated,
      withinWindow,
      windowEnd: windowEnd.toISOString(),
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};

// PATCH /api/students/:id/interests  { interests?, sports? } (Admin / Registrar)
const updateStudentInterests = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({ where: { id: req.params.id }, select: { id: true, interests: true, sports: true } });
    if (!student) return res.status(404).json({ error: 'Student not found' });
    let choices;
    try { choices = await checkChoices(req.body || {}, student); } catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
    const data = {};
    if (choices.interests !== undefined) data.interests = choices.interests;
    if (choices.sports !== undefined) data.sports = choices.sports;
    if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to change' });
    const updated = await prisma.student.update({ where: { id: student.id }, data, select: { id: true, interests: true, sports: true } });
    res.json({ message: 'Saved', ...updated });
  } catch (err) {
    console.error('Update interests error:', err);
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

// PATCH /api/students/me/documents - Student self-service document upload
const uploadMyDocuments = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({ where: { user_id: req.user.id } });
    if (!student) return res.status(404).json({ error: 'Student profile not found' });

    const {
      medical_report,
      kcse_certificate,
      birth_certificate,
      other_documents,
    } = req.files || {};

    const updateData = {};

    if (medical_report) {
      const { url } = await uploadToS3(medical_report[0].buffer, medical_report[0].originalname, 'student-documents');
      updateData.medical_report_url = url;
    }
    if (kcse_certificate) {
      const { url } = await uploadToS3(kcse_certificate[0].buffer, kcse_certificate[0].originalname, 'student-documents');
      updateData.kcse_certificate_url = url;
    }
    if (birth_certificate) {
      const { url } = await uploadToS3(birth_certificate[0].buffer, birth_certificate[0].originalname, 'student-documents');
      updateData.birth_certificate_url = url;
    }
    if (other_documents) {
      const { url } = await uploadToS3(other_documents[0].buffer, other_documents[0].originalname, 'student-documents');
      updateData.other_documents_url = url;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'At least one document file is required' });
    }

    const updated = await prisma.student.update({
      where: { user_id: req.user.id },
      data: updateData,
      include: {
        application: { select: { surname: true, other_names: true, email: true } },
        course: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    res.json({
      message: 'Documents uploaded successfully',
      student: {
        id: updated.id,
        admission_no: updated.admission_no,
        medical_report_url: updated.medical_report_url,
        kcse_certificate_url: updated.kcse_certificate_url,
        birth_certificate_url: updated.birth_certificate_url,
        other_documents_url: updated.other_documents_url,
      },
    });
  } catch (err) {
    console.error('Student document upload error:', err);
    res.status(500).json({ error: 'Failed to upload documents' });
  }
};

// ---------------------------------------------------------------------------
// deleteStudent — cascades through all FK-linked records in the correct order
// ---------------------------------------------------------------------------
const deleteStudent = async (req, res) => {
  const { id } = req.params;
  try {
    const student = await prisma.student.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true } },
        application: { select: { id: true } },
      },
    });

    if (!student) return res.status(404).json({ error: 'Student not found' });

    const linkedUnder = await prisma.student.findMany({ where: { primary_student_id: id }, select: { admission_no: true } });
    if (linkedUnder.length) {
      return res.status(409).json({ error: `${student.admission_no} holds the login for ${linkedUnder.map((l) => l.admission_no).join(', ')}. Unlink ${linkedUnder.length === 1 ? 'it' : 'them'} first.` });
    }

    // Delete in FK dependency order
    await prisma.studentBalance.deleteMany({ where: { student_id: id } });
    await prisma.feeRecord.deleteMany({ where: { student_id: id } });
    await prisma.studentProgression.deleteMany({ where: { student_id: id } });
    await prisma.admissionLetter.deleteMany({ where: { student_id: id } });
    await prisma.studentDocument.deleteMany({ where: { student_id: id } });
    await prisma.application.updateMany({ where: { continuing_student_id: id }, data: { continuing_student_id: null } });

    if (student.user?.id) {
      await prisma.refreshToken.deleteMany({ where: { user_id: student.user.id } });
    }

    await prisma.student.delete({ where: { id } });

    if (student.application?.id) {
      await prisma.application.delete({ where: { id: student.application.id } });
    }

    if (student.user?.id) {
      await prisma.user.delete({ where: { id: student.user.id } });
    }

    return res.json({ message: `Student ${student.admission_no} and all linked records deleted successfully.` });
  } catch (err) {
    console.error('deleteStudent error:', err);
    res.status(500).json({ error: 'Failed to delete student' });
  }
};

// ---------------------------------------------------------------------------
// getDuplicates — finds students sharing the same (surname + other_names)
// ---------------------------------------------------------------------------
const getDuplicates = async (req, res) => {
  try {
    const students = await prisma.student.findMany({
      include: {
        application: { select: { surname: true, other_names: true, email: true } },
        course: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: { created_at: 'asc' },
    });

    // Group by normalised full name
    const groups = {};
    for (const s of students) {
      const name = `${s.application?.surname || ''} ${s.application?.other_names || ''}`.trim().toLowerCase();
      if (!groups[name]) groups[name] = [];
      groups[name].push(s);
    }

    // Keep only groups with more than 1 student
    // a name whose records are all linked under one login is already dealt with
    const allLinked = (g) => {
      const owner = g[0].primary_student_id || g[0].id;
      return g.every((x) => x.id === owner || x.primary_student_id === owner);
    };
    const duplicates = Object.values(groups)
      .filter(g => g.length > 1 && !allLinked(g))
      .map(g => ({
        name: `${g[0].application?.surname || ''} ${g[0].application?.other_names || ''}`.trim(),
        count: g.length,
        students: g.map(s => ({
          id: s.id,
          admission_no: s.admission_no,
          course: s.course?.name,
          department: s.department?.name,
          level: s.level,
          intake: s.intake,
          status: s.status,
          email: s.application?.email,
          created_at: s.created_at,
        })),
      }));

    return res.json({ total_duplicate_groups: duplicates.length, duplicates });
  } catch (err) {
    console.error('getDuplicates error:', err);
    res.status(500).json({ error: 'Failed to fetch duplicates' });
  }
};

// POST /api/students/:id/merge  body: { merge_student_id }
// Folds an older record of the same person (merge_student_id) into this one (:id)
const mergeStudentRecords = async (req, res) => {
  try {
    const { merge_student_id } = req.body || {};
    if (!merge_student_id) return res.status(400).json({ error: 'merge_student_id is required' });
    const result = await mergeStudents(req.params.id, merge_student_id, req.user.id);
    res.json({
      message: `Linked ${result.merged} into ${result.kept}. The earlier record is now part of this student's history, and the total enrolled does not go down.`,
      ...result,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Merge students error:', err);
    res.status(500).json({ error: 'Failed to link student records' });
  }
};

module.exports = {
  updateStudentInterests,
  mergeStudentRecords,
  getStudents, getStudentById, getMyProfile, updateStudent,
  updateMyProfile, uploadPhoto, uploadStudentDocuments, uploadMyDocuments, getStudentStats,
  uploadMyProfilePicture, generateIdCard, generatePrefilledDocument, enrollInTerm,
  getMyEnrollments, assignStudentTerm, bulkAssignTerm, 
  deleteStudent, getDuplicates,
};

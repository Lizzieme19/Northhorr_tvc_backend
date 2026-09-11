const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { uploadToS3 } = require('../middleware/upload');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, BUCKET_NAME } = require('../config/s3');
const prisma = require('../config/db');
const { generateAdmissionLetter } = require('../services/documentService');

// POST /api/admissions/generate/:student_id
const generateLetter = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.student_id },
      include: {
        application: true,
        course: true,
        department: true,
      },
    });

    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Check if letter already exists
    const existing = await prisma.admissionLetter.findUnique({
      where: { student_id: student.id },
    });
    if (existing) {
      return res.json({ message: 'Letter already generated', letter_url: existing.letter_url });
    }

    // Generate PDF in memory
    const activeFees = await prisma.feeType.findMany({ where: { is_active: true } });
    const pdfBuffer = await generateAdmissionLetter(student, activeFees);

    // Upload to B2
    const fileName = `${student.admission_no.replace(/\//g, '_')}_admission_letter.pdf`;
    const { url } = await uploadToS3(pdfBuffer, fileName, 'letters');

    // Save record
    const letter = await prisma.admissionLetter.create({
      data: {
        student_id: student.id,
        generated_by: req.user.id,
        letter_url: url,
      },
    });

    res.json({
      message: 'Admission letter generated successfully',
      letter_url: url,
      letter_id: letter.id,
    });
  } catch (err) {
    console.error('Letter generation error:', err);
    res.status(500).json({ error: 'Failed to generate admission letter' });
  }
};

// GET /api/admissions/letter/:student_id
const downloadLetter = async (req, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.student_id },
    });
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // Students can only download their own letter
    if (req.user.role === 'STUDENT' && student.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const letter = await prisma.admissionLetter.findUnique({
      where: { student_id: student.id },
    });
    if (!letter) return res.status(404).json({ error: 'Admission letter not yet generated' });

    // Redirect to B2 URL (or proxy the file)
    res.redirect(letter.letter_url);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};



module.exports = { generateLetter, downloadLetter };

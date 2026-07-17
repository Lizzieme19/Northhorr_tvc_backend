const PDFDocument = require('pdfkit');
const { uploadToS3 } = require('../middleware/upload');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { s3Client, BUCKET_NAME } = require('../config/s3');
const prisma = require('../config/db');

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
    const pdfBuffer = await generateAdmissionPDF(student);

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

// PDF Generation Helper
const generateAdmissionPDF = (student) => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: 'A4' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const app = student.application;
    const fullName = `${app.surname} ${app.other_names}`.toUpperCase();
    const today = new Date().toLocaleDateString('en-GB', {
      day: '2-digit', month: 'long', year: 'numeric',
    });

    // ── Header ──────────────────────────────────────────────
    doc.fontSize(18).font('Helvetica-Bold')
      .fillColor('#1F6F4A')
      .text('NORTH HORR TECHNICAL AND VOCATIONAL COLLEGE', { align: 'center' });

    doc.fontSize(10).font('Helvetica')
      .fillColor('#555')
      .text('P.O. Box 12, North Horr, Marsabit County, Kenya', { align: 'center' })
      .text('Tel: +254 700 000 000 | Email: admissions@ntvc.ac.ke', { align: 'center' })
      .moveDown(0.5);

    // Divider
    doc.moveTo(60, doc.y).lineTo(535, doc.y).strokeColor('#1F6F4A').lineWidth(2).stroke();
    doc.moveDown(0.5);

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#1F6F4A')
      .text('LETTER OF ADMISSION', { align: 'center' });
    doc.moveDown(0.5);

    // Ref & Date
    doc.fontSize(10).font('Helvetica').fillColor('#333')
      .text(`Ref: ${student.admission_no}`, 60)
      .text(`Date: ${today}`, 60)
      .moveDown(0.8);

    // Salutation
    doc.text(`Dear ${fullName},`, 60);
    doc.moveDown(0.5);

    // Intro paragraph
    doc.text(
      `Following your application to North Horr Technical and Vocational College (NTVC), we are pleased to inform you that you have been provisionally admitted to the following programme:`,
      60, doc.y, { width: 475 }
    );
    doc.moveDown(0.8);

    // Admission details box
    const boxTop = doc.y;
    doc.rect(60, boxTop, 475, 130).fillColor('#f5f9f6').fill();
    doc.fillColor('#1F6F4A').font('Helvetica-Bold').fontSize(12)
      .text('ADMISSION DETAILS', 80, boxTop + 12);
    doc.font('Helvetica').fontSize(10).fillColor('#333');

    const row = (label, value, y) => {
      doc.font('Helvetica-Bold').text(label, 80, y, { continued: true });
      doc.font('Helvetica').text(`  ${value}`);
    };

    row('Full Name:', fullName, boxTop + 32);
    row('Admission Number:', student.admission_no, boxTop + 50);
    row('Programme:', student.course?.name || 'N/A', boxTop + 68);
    row('Department:', student.department?.name || 'N/A', boxTop + 86);
    row('Level:', student.level, boxTop + 104);
    row('Intake:', `${student.intake} ${student.year}`, boxTop + 122);

    doc.y = boxTop + 140;
    doc.moveDown(0.8);

    // Requirements section
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1F6F4A')
      .text('REPORTING REQUIREMENTS', 60);
    doc.font('Helvetica').fontSize(10).fillColor('#333').moveDown(0.3);

    const requirements = [
      'Report to the college within 14 days of receiving this letter.',
      'Bring original copies of ALL academic certificates for verification.',
      'Carry your National ID / Birth Certificate (original).',
      'Medical Examination Certificate (original).',
      'Two recent passport-sized photographs.',
    ];
    requirements.forEach((r) => {
      doc.text(`• ${r}`, 70, doc.y, { width: 465 });
    });

    doc.moveDown(0.8);

    // Fees section
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#1F6F4A').text('FEES PAYABLE ON REPORTING', 60);
    doc.font('Helvetica').fontSize(10).fillColor('#333').moveDown(0.3);

    const fees = [
      ['Admission Fee', 'KES 1,500'],
      ['Student ID Fee', 'KES 500'],
      ...(app.type === 'DIRECT' ? [['KUCCPS Processing Fee', 'KES 500']] : []),
    ];
    fees.forEach(([item, amount]) => {
      doc.text(`• ${item}:`, 70, doc.y, { continued: true }).font('Helvetica-Bold').text(`  ${amount}`);
      doc.font('Helvetica');
    });

    doc.moveDown(0.5);
    doc.font('Helvetica').text(
      'Note: Show proof of HELB application at the finance office. Payment can be made via M-Pesa or bank transfer.',
      60, doc.y, { width: 475 }
    );

    doc.moveDown(1);

    // Closing
    doc.text('We look forward to welcoming you to NTVC. Should you have any queries, do not hesitate to contact the admissions office.', 60, doc.y, { width: 475 });
    doc.moveDown(1);
    doc.text('Yours faithfully,', 60);
    doc.moveDown(2);
    doc.font('Helvetica-Bold').text('THE PRINCIPAL', 60);
    doc.font('Helvetica').text('North Horr Technical and Vocational College', 60);

    // Footer
    doc.moveTo(60, 770).lineTo(535, 770).strokeColor('#1F6F4A').lineWidth(1).stroke();
    doc.fontSize(8).fillColor('#888')
      .text(
        'NTVC is accredited by TVETA & KNQA | www.ntvc.ac.ke | info@ntvc.ac.ke',
        60, 776, { align: 'center', width: 475 }
      );

    doc.end();
  });
};

module.exports = { generateLetter, downloadLetter };

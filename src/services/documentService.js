const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const https = require('https');
const prisma = require('../config/db');

// Asset paths
const MINISTRY_LOGO = path.join(__dirname, '../../public/Ministry.png');
const COLLEGE_LOGO = path.join(__dirname, '../../public/logo.png');

// Brand colours
const GREEN = '#1F6F4A';
const DARK = '#111827';
const GREY = '#4B5563';
const LIGHT_GREY = '#9CA3AF';
const BG_GREEN = '#F0FDF4';
const BG_BLUE = '#EFF6FF';
const BG_RED = '#FEF2F2';
const BG_YELLOW = '#FFFBEB';

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

async function fetchImageBuffer(url) {
  if (!url) return null;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return resolve(null);
      }
      const data = [];
      res.on('data', (chunk) => data.push(chunk));
      res.on('end', () => resolve(Buffer.concat(data)));
    }).on('error', () => resolve(null));
  });
}

// ─────────────────────────────────────────────────────────
// BASE BUILDER
// ─────────────────────────────────────────────────────────

function buildPDF(drawFn, options = {}) {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, ...options });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      await drawFn(doc);
    } catch (e) {
      reject(e);
      return;
    }
    doc.end();
  });
}

// ─────────────────────────────────────────────────────────
// SHARED COMPONENTS
// ─────────────────────────────────────────────────────────

async function drawHeader(doc, subtitle = '', customLogos = {}) {
  const pageLeft = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;
  const logoSize = 60;

  let ministryBuffer = customLogos.ministry;
  if (!ministryBuffer && fs.existsSync(MINISTRY_LOGO)) {
    ministryBuffer = MINISTRY_LOGO;
  }
  if (ministryBuffer) {
    try { doc.image(ministryBuffer, pageLeft, 40, { width: logoSize, height: logoSize }); } catch(e){}
  }

  let collegeBuffer = customLogos.college;
  if (!collegeBuffer && fs.existsSync(COLLEGE_LOGO)) {
    collegeBuffer = COLLEGE_LOGO;
  }
  if (collegeBuffer) {
    try { doc.image(collegeBuffer, pageRight - logoSize, 40, { width: logoSize, height: logoSize }); } catch(e){}
  }

  const textLeft = pageLeft + logoSize + 8;
  const textWidth = pageRight - pageLeft - logoSize * 2 - 16;
  doc
    .fillColor('#555').fontSize(7.5).font('Helvetica')
    .text('MINISTRY OF EDUCATION — STATE DEPARTMENT FOR VOCATIONAL & TECHNICAL TRAINING', textLeft, 48, { width: textWidth, align: 'center' });
  doc
    .fillColor(GREEN).fontSize(14).font('Helvetica-Bold')
    .text('NORTH HORR TECHNICAL AND VOCATIONAL COLLEGE', textLeft, 62, { width: textWidth, align: 'center' });
  doc
    .fillColor(GREY).fontSize(8).font('Helvetica')
    .text('P.O. Box 12, North Horr, Marsabit County, Kenya  |  Tel: +254 700 000 000  |  admissions@ntvc.ac.ke', textLeft, 80, { width: textWidth, align: 'center' });

  if (subtitle) {
    doc
      .fillColor(DARK).fontSize(11).font('Helvetica-Bold')
      .text(subtitle.toUpperCase(), textLeft, 95, { width: textWidth, align: 'center' });
  }

  const dividerY = subtitle ? 112 : 100;
  doc.moveTo(pageLeft, dividerY).lineTo(pageRight, dividerY).strokeColor(GREEN).lineWidth(1.5).stroke();
  return dividerY + 12;
}

function drawFooter(doc, refText = '') {
  const pageLeft = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;
  const footerY = doc.page.height - 40;
  doc.moveTo(pageLeft, footerY).lineTo(pageRight, footerY).strokeColor(GREEN).lineWidth(0.5).stroke();
  doc
    .fillColor(LIGHT_GREY).fontSize(7.5).font('Helvetica')
    .text(
      `NTVC is accredited by TVETA & KNQA  |  www.ntvc.ac.ke  |  info@ntvc.ac.ke${refText ? '  |  ' + refText : ''}`,
      pageLeft, footerY + 6, { align: 'center', width: pageRight - pageLeft }
    );
}

function fmtDate(d) {
  if (!d) return 'N/A';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

function fmtKES(amount) {
  if (amount === null || amount === undefined) return 'N/A';
  return `KES ${Number(amount).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─────────────────────────────────────────────────────────
// ACADEMIC DOCUMENTS
// ─────────────────────────────────────────────────────────

async function generateAdmissionLetter(student, feeTypes = []) {
  return buildPDF(async (doc) => {
    const template = await prisma.documentTemplate.findUnique({
      where: { document_type: 'ADMISSION_LETTER' }
    });

    const customLogos = {
      ministry: await fetchImageBuffer(template?.ministry_logo_url),
      college: await fetchImageBuffer(template?.college_logo_url)
    };

    const textBlocks = template?.text_blocks || {};
    const getBlock = (key, defaultText) => {
      let txt = textBlocks[key] || defaultText;
      return txt.replace(/\[STUDENT_NAME\]/g, fullName)
                .replace(/\[ADMISSION_NO\]/g, student.admission_no)
                .replace(/\[PROGRAMME\]/g, student.course?.name || 'N/A');
    };

    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const contentWidth = pageRight - pageLeft;
    const app = student.application;
    const fullName = `${app.surname} ${app.other_names}`.toUpperCase();
    const today = fmtDate(new Date());
    let y = await drawHeader(doc, 'Letter of Admission', customLogos);

    doc.font('Helvetica').fontSize(9.5).fillColor(GREY)
      .text(`Ref: ${student.admission_no}`, pageLeft, y)
      .text(`Date: ${today}`, pageLeft, y + 13);
    y += 34;

    doc.font('Helvetica').fontSize(10.5).fillColor(DARK).text(`Dear ${fullName},`, pageLeft, y);
    y += 20;

    const introText = getBlock('intro', 'Following your application to North Horr Technical and Vocational College (NTVC), we are pleased to inform you that you have been provisionally admitted to the following programme:');
    doc.font('Helvetica').fontSize(10.5).fillColor(DARK)
      .text(introText, pageLeft, y, { width: contentWidth });
    y = doc.y + 14;

    const boxH = 128;
    doc.rect(pageLeft, y, contentWidth, boxH).fillColor(BG_GREEN).fill();
    doc.rect(pageLeft, y, 4, boxH).fillColor(GREEN).fill();
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(10.5).text('ADMISSION DETAILS', pageLeft + 14, y + 10);
    const rows = [
      ['Full Name:', fullName],
      ['Admission Number:', student.admission_no],
      ['Programme:', student.course?.name || 'N/A'],
      ['Department:', student.department?.name || 'N/A'],
      ['Level:', student.level],
      ['Intake / Year:', `${student.intake} ${student.year}`],
    ];
    rows.forEach(([label, val], i) => {
      const ry = y + 28 + i * 16;
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(label, pageLeft + 14, ry, { width: 155 });
      doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(val, pageLeft + 172, ry, { width: contentWidth - 190 });
    });
    y += boxH + 14;

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(GREEN).text('REPORTING REQUIREMENTS', pageLeft, y);
    y = doc.y + 4;
    [
      'Report to the college within 14 days of receiving this letter.',
      'Bring original copies of ALL academic certificates and transcripts for verification.',
      'National ID / Birth Certificate (original and photocopy).',
      'Medical Examination Certificate (original).',
      'Two recent passport-sized colour photographs.',
      'Show proof of HELB application at the Finance Office if applicable.',
    ].forEach((r) => {
      doc.font('Helvetica').fontSize(10).fillColor(DARK).text(`•  ${r}`, pageLeft + 10, doc.y, { width: contentWidth - 10 });
    });
    y = doc.y + 14;

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(GREEN).text('FEES PAYABLE ON REPORTING', pageLeft, y);
    y = doc.y + 4;
    const onTimeFees = feeTypes.length > 0 ? feeTypes.filter(f => !f.term_based) : [{ name: 'Admission Fee', amount: 1500 }, { name: 'Student ID Fee', amount: 500 }];
    onTimeFees.forEach((f) => {
      doc.font('Helvetica').fontSize(10).fillColor(DARK)
        .text(`•  ${f.name}:`, pageLeft + 10, doc.y, { continued: true, width: 250 });
      doc.font('Helvetica-Bold').text(`  ${fmtKES(f.amount)}`);
    });
    y = doc.y + 6;
    doc.font('Helvetica').fontSize(9).fillColor(GREY)
      .text('Note: Payment can be made via M-Pesa, bank transfer, or cash at the Finance Office.', pageLeft, y, { width: contentWidth });
    y = doc.y + 18;

    doc.font('Helvetica').fontSize(10.5).fillColor(DARK)
      .text('We look forward to welcoming you to NTVC. Should you have any queries, please do not hesitate to contact the Admissions Office.', pageLeft, y, { width: contentWidth });
    y = doc.y + 22;
    doc.font('Helvetica').fontSize(10.5).fillColor(DARK).text('Yours faithfully,', pageLeft, y);
    y = doc.y + 36;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(DARK).text('THE PRINCIPAL', pageLeft, y);
    doc.font('Helvetica').fontSize(10).fillColor(GREY).text('North Horr Technical and Vocational College', pageLeft);
    drawFooter(doc, student.admission_no);
  });
}

async function generateLetterOfAcceptance(student) {
  return buildPDF(async (doc) => {
    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const contentWidth = pageRight - pageLeft;
    const app = student.application;
    const fullName = `${app.surname} ${app.other_names}`.toUpperCase();
    const refNo = `NTVC/ADM/${student.admission_no}`;
    let y = drawHeader(doc, 'Letter of Acceptance');

    doc.font('Helvetica').fontSize(9.5).fillColor(GREY)
      .text(`Ref: ${refNo}`, pageLeft, y)
      .text(`Date: ${fmtDate(new Date())}`, pageLeft, y + 13);
    y += 36;

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(DARK).text(fullName, pageLeft, y);
    if (app.address) doc.font('Helvetica').fontSize(10).fillColor(GREY).text(app.address, pageLeft);
    y = doc.y + 16;

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(DARK)
      .text(`RE: ACCEPTANCE OF ADMISSION — ${student.course?.name?.toUpperCase() || 'PROGRAMME'}`, pageLeft, y, { width: contentWidth });
    y = doc.y + 12;
    doc.font('Helvetica').fontSize(10.5).fillColor(DARK).text(`Dear ${app.surname} ${app.other_names},`, pageLeft, y);
    y = doc.y + 12;
    doc.font('Helvetica').fontSize(10.5).fillColor(DARK)
      .text('With reference to the admission offer made to you by North Horr Technical and Vocational College (NTVC), we are pleased to confirm your acceptance into the following programme:', pageLeft, y, { width: contentWidth });
    y = doc.y + 14;

    const boxH = 100;
    doc.rect(pageLeft, y, contentWidth, boxH).fillColor(BG_BLUE).fill();
    doc.rect(pageLeft, y, 4, boxH).fillColor('#1D4ED8').fill();
    doc.fillColor('#1E40AF').font('Helvetica-Bold').fontSize(10.5).text('PROGRAMME DETAILS', pageLeft + 14, y + 10);
    [
      ['Admission Number:', student.admission_no],
      ['Programme:', student.course?.name || 'N/A'],
      ['Department:', student.department?.name || 'N/A'],
      ['Level:', student.level],
      ['Intake / Year:', `${student.intake} ${student.year}`],
    ].forEach(([label, val], i) => {
      const ry = y + 26 + i * 14;
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(label, pageLeft + 14, ry, { width: 155 });
      doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(val, pageLeft + 172, ry, { width: contentWidth - 190 });
    });
    y += boxH + 14;

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(GREEN).text('CONDITIONS OF ACCEPTANCE', pageLeft, y);
    y = doc.y + 4;
    [
      'You are required to report to the college within 14 days of this letter.',
      'You must present original academic certificates and identification documents at reporting.',
      'Payment of all prescribed fees is required to confirm your enrolment.',
      'You must abide by all college rules, regulations, and academic policies.',
      'This offer is subject to verification of all academic qualifications presented.',
    ].forEach((c, i) => {
      doc.font('Helvetica').fontSize(10).fillColor(DARK).text(`${i + 1}.  ${c}`, pageLeft + 10, doc.y, { width: contentWidth - 10 });
    });
    y = doc.y + 18;

    doc.font('Helvetica').fontSize(10.5).fillColor(DARK)
      .text('We are delighted to welcome you to the NTVC family. We are confident that your time here will be both rewarding and enriching.', pageLeft, y, { width: contentWidth });
    y = doc.y + 20;
    doc.font('Helvetica').fontSize(10.5).fillColor(DARK).text('Yours sincerely,', pageLeft, y);
    y = doc.y + 36;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(DARK).text('THE PRINCIPAL', pageLeft, y);
    doc.font('Helvetica').fontSize(10).fillColor(GREY).text('North Horr Technical and Vocational College', pageLeft);
    drawFooter(doc, refNo);
  });
}

async function generateAdmissionForTraining(student) {
  return buildPDF(async (doc) => {
    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const contentWidth = pageRight - pageLeft;
    const app = student.application;
    const refNo = `NTVC/TR/${student.admission_no}`;
    let y = drawHeader(doc, 'Admission for Training');

    doc.font('Helvetica').fontSize(9.5).fillColor(GREY)
      .text(`Ref: ${refNo}`, pageLeft, y)
      .text(`Date: ${fmtDate(new Date())}`, pageLeft, y + 13);
    y += 36;

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(DARK).text(`${app.surname} ${app.other_names}`.toUpperCase(), pageLeft, y);
    if (app.address) doc.font('Helvetica').fontSize(10).fillColor(GREY).text(app.address, pageLeft);
    y = doc.y + 16;

    doc.font('Helvetica').fontSize(10.5).fillColor(DARK).text(`Dear ${app.surname} ${app.other_names},`, pageLeft, y);
    y = doc.y + 12;
    doc.font('Helvetica').fontSize(10.5).fillColor(DARK)
      .text('You have been admitted for training at North Horr Technical and Vocational College (NTVC) under the following programme. Please report to the college on the specified date with all required documents.', pageLeft, y, { width: contentWidth });
    y = doc.y + 14;

    const trainingRows = [
      ['Programme:', student.course?.name || 'N/A'],
      ['Department:', student.department?.name || 'N/A'],
      ['Level:', student.level],
      ['Intake / Year:', `${student.intake} ${student.year}`],
      ['Admission Number:', student.admission_no],
      ['Reporting Date:', fmtDate(student.reporting_date)],
      ['Reporting Deadline:', fmtDate(student.reporting_deadline)],
      ['Duration:', student.course?.duration || 'As per programme'],
    ];
    const boxH = trainingRows.length * 17 + 28;
    doc.rect(pageLeft, y, contentWidth, boxH).fillColor(BG_GREEN).fill();
    doc.rect(pageLeft, y, 4, boxH).fillColor(GREEN).fill();
    doc.fillColor(GREEN).font('Helvetica-Bold').fontSize(10.5).text('TRAINING PROGRAMME DETAILS', pageLeft + 14, y + 10);
    trainingRows.forEach(([label, val], i) => {
      const ry = y + 26 + i * 17;
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(label, pageLeft + 14, ry, { width: 170 });
      doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(val, pageLeft + 186, ry, { width: contentWidth - 200 });
    });
    y += boxH + 14;

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(GREEN).text('WHAT TO BRING ON REPORTING DAY', pageLeft, y);
    y = doc.y + 4;
    [
      'Original and certified copies of all academic certificates (KCPE, KCSE, etc.)',
      'National ID or Birth Certificate (original + photocopy)',
      'Two recent passport-size photographs',
      'Medical Examination Certificate from a registered medical officer',
      'This admission letter',
      'Proof of fee payment or arrangement letter from Finance',
    ].forEach((item) => {
      doc.font('Helvetica').fontSize(10).fillColor(DARK).text(`•  ${item}`, pageLeft + 10, doc.y, { width: contentWidth - 10 });
    });
    y = doc.y + 18;

    doc.font('Helvetica').fontSize(10.5).fillColor(DARK)
      .text('Please ensure you report on the specified date. Late reporting may affect your enrolment. For inquiries, contact the Admissions Office.', pageLeft, y, { width: contentWidth });
    y = doc.y + 20;
    doc.font('Helvetica').fontSize(10.5).fillColor(DARK).text('Yours faithfully,', pageLeft, y);
    y = doc.y + 36;
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(DARK).text('THE PRINCIPAL', pageLeft, y);
    doc.font('Helvetica').fontSize(10).fillColor(GREY).text('North Horr Technical and Vocational College', pageLeft);
    drawFooter(doc, refNo);
  });
}

async function generateFeeStructure(student, feeTypes = []) {
  return buildPDF(async (doc) => {
    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const contentWidth = pageRight - pageLeft;
    const app = student.application;
    const fullName = `${app.surname} ${app.other_names}`.toUpperCase();
    let y = drawHeader(doc, 'Student Fee Structure');

    // Student details strip
    const sBoxH = 66;
    doc.rect(pageLeft, y, contentWidth, sBoxH).fillColor('#F9FAFB').fill();
    doc.rect(pageLeft, y, contentWidth, sBoxH).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
    [
      ['Student Name:', fullName],
      ['Admission Number:', student.admission_no],
      ['Programme:', student.course?.name || 'N/A'],
      ['Department:', student.department?.name || 'N/A'],
    ].forEach(([label, val], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const rx = pageLeft + 14 + col * (contentWidth / 2);
      const ry = y + 12 + row * 22;
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(label, rx, ry, { width: 130 });
      doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(val, rx + 133, ry, { width: contentWidth / 2 - 145 });
    });
    y += sBoxH + 16;

    const drawFeeTable = (title, fees, startY) => {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(GREEN).text(title, pageLeft, startY);
      let ty = doc.y + 4;
      doc.rect(pageLeft, ty, contentWidth, 22).fillColor(GREEN).fill();
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF')
        .text('#', pageLeft + 10, ty + 6, { width: 25 })
        .text('Fee Name', pageLeft + 38, ty + 6, { width: 280 })
        .text('Amount (KES)', pageLeft + 330, ty + 6, { width: 140, align: 'right' });
      ty += 22;
      let total = 0;
      fees.forEach((fee, idx) => {
        const bg = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
        doc.rect(pageLeft, ty, contentWidth, 20).fillColor(bg).fill();
        doc.rect(pageLeft, ty, contentWidth, 20).strokeColor('#E5E7EB').lineWidth(0.3).stroke();
        doc.font('Helvetica').fontSize(9.5).fillColor(DARK)
          .text(`${idx + 1}`, pageLeft + 10, ty + 5, { width: 25 })
          .text(fee.name, pageLeft + 38, ty + 5, { width: 280 });
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK)
          .text(fmtKES(fee.amount), pageLeft + 330, ty + 5, { width: 140, align: 'right' });
        total += Number(fee.amount);
        ty += 20;
      });
      doc.rect(pageLeft, ty, contentWidth, 22).fillColor(GREEN).fill();
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#FFFFFF')
        .text('TOTAL', pageLeft + 38, ty + 5, { width: 280 })
        .text(fmtKES(total), pageLeft + 330, ty + 5, { width: 140, align: 'right' });
      return ty + 22 + 14;
    };

    const oneTime = feeTypes.filter(f => !f.term_based && f.is_active);
    const termBased = feeTypes.filter(f => f.term_based && f.is_active);
    const defaultFees = [{ name: 'Admission Fee', amount: 1500 }, { name: 'Student ID Card Fee', amount: 500 }];
    y = drawFeeTable('ONE-TIME FEES (Payable on Admission)', oneTime.length > 0 ? oneTime : defaultFees, y);
    if (termBased.length > 0) y = drawFeeTable('TERM-BASED FEES (Per Term)', termBased, y);

    doc.rect(pageLeft, y, contentWidth, 52).fillColor(BG_YELLOW).fill();
    doc.rect(pageLeft, y, 4, 52).fillColor('#D97706').fill();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#92400E').text('PAYMENT INFORMATION', pageLeft + 14, y + 8);
    doc.font('Helvetica').fontSize(9).fillColor(DARK)
      .text('Fees can be paid at the Finance Office via cash, bank transfer, or M-Pesa. Students should retain all payment receipts.', pageLeft + 14, y + 22, { width: contentWidth - 28 });
    drawFooter(doc);
  });
}

async function generateStudentPersonalInfo(student) {
  return buildPDF(async (doc) => {
    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const contentWidth = pageRight - pageLeft;
    const app = student.application;
    const fullName = `${app.surname} ${app.other_names}`.toUpperCase();
    let y = drawHeader(doc, 'Student Personal Information Record');

    doc.font('Helvetica-Bold').fontSize(13).fillColor(DARK).text(fullName, pageLeft, y, { width: contentWidth });
    doc.font('Helvetica').fontSize(10).fillColor(GREY)
      .text(`Admission No: ${student.admission_no}  |  Status: ${student.status}  |  Generated: ${fmtDate(new Date())}`, pageLeft);
    y = doc.y + 14;

    const drawSection = (title, rows) => {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(GREEN).text(title.toUpperCase(), pageLeft, doc.y);
      const secY = doc.y + 3;
      doc.moveTo(pageLeft, secY).lineTo(pageRight, secY).strokeColor(GREEN).lineWidth(0.4).stroke();
      let ry = secY + 6;
      rows.forEach(([label, val]) => {
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(label, pageLeft, ry, { width: 165 });
        doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(String(val ?? 'N/A'), pageLeft + 168, ry, { width: contentWidth - 168 });
        ry += 16;
      });
      doc.y = ry + 8;
    };

    drawSection('Personal Details', [
      ['Surname:', app.surname], ['Other Names:', app.other_names],
      ['Date of Birth:', fmtDate(app.date_of_birth)], ['Gender:', app.gender],
      ['Nationality:', app.nationality], ['Religion:', app.religion],
      ['National ID No:', app.id_number], ['Birth Certificate No:', app.birth_cert_no],
    ]);
    drawSection('Academic Enrolment', [
      ['Programme:', student.course?.name], ['Department:', student.department?.name],
      ['Level:', student.level], ['Intake / Year:', `${student.intake} ${student.year}`],
      ['Application Type:', app.type], ['KCSE Index No:', app.kcse_index],
      ['KCSE Grade:', app.kcse_grade], ['Previous School:', app.previous_school],
    ]);
    drawSection('Contact Information', [
      ['Phone:', app.phone], ['Email:', app.email], ['Address:', app.address],
    ]);
    drawSection('Parent / Guardian Details', [
      ['Parent/Guardian Name:', app.parent_names], ['Relationship:', app.parent_relationship],
      ['Phone:', app.parent_phone], ['Father Name:', app.father_name],
      ['Father Phone:', app.father_phone], ['Mother Name:', app.mother_name],
      ['Mother Phone:', app.mother_phone],
    ]);
    drawSection('Medical Information', [
      ['Medical Conditions:', app.medical_conditions || 'None declared'],
      ['Allergies:', app.allergies || 'None declared'],
      ['Disability:', app.disability || 'None declared'],
      ['Emergency Contact:', app.emergency_person], ['Emergency Phone:', app.emergency_phone],
    ]);
    drawFooter(doc, student.admission_no);
  });
}

// ─────────────────────────────────────────────────────────
// PROCUREMENT DOCUMENTS
// ─────────────────────────────────────────────────────────

async function generateLPO(lpo) {
  return buildPDF(async (doc) => {
    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const contentWidth = pageRight - pageLeft;
    let y = drawHeader(doc, 'Local Purchase Order');

    // Banner
    doc.rect(pageLeft, y, contentWidth, 28).fillColor(GREEN).fill();
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF')
      .text(`LPO NO: ${lpo.lpo_no}`, pageLeft + 12, y + 7, { continued: true, width: contentWidth / 2 });
    doc.font('Helvetica').fontSize(10).fillColor('#FFFFFF')
      .text(`Status: ${lpo.status}`, { align: 'right', width: contentWidth / 2 - 12 });
    y += 28 + 10;

    // Two-column info
    const colW = (contentWidth - 10) / 2;
    const col2X = pageLeft + colW + 10;
    const infoBoxH = 96;
    doc.rect(pageLeft, y, colW, infoBoxH).fillColor('#F9FAFB').fill();
    doc.rect(pageLeft, y, colW, infoBoxH).strokeColor('#E5E7EB').lineWidth(0.4).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GREEN).text('SUPPLIER', pageLeft + 10, y + 8);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(lpo.supplier.name, pageLeft + 10, y + 22, { width: colW - 20 });
    doc.font('Helvetica').fontSize(9).fillColor(GREY)
      .text(lpo.supplier.contact_person ? `Attn: ${lpo.supplier.contact_person}` : '', pageLeft + 10, doc.y, { width: colW - 20 })
      .text(lpo.supplier.phone || '', pageLeft + 10)
      .text(lpo.supplier.email || '', pageLeft + 10)
      .text(lpo.supplier.address || '', pageLeft + 10, doc.y, { width: colW - 20 });

    doc.rect(col2X, y, colW, infoBoxH).fillColor('#F9FAFB').fill();
    doc.rect(col2X, y, colW, infoBoxH).strokeColor('#E5E7EB').lineWidth(0.4).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GREEN).text('ISSUING AUTHORITY', col2X + 10, y + 8);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text('North Horr TVC', col2X + 10, y + 22);
    doc.font('Helvetica').fontSize(9).fillColor(GREY)
      .text(`Department: ${lpo.department?.name || 'N/A'}`, col2X + 10, doc.y)
      .text(`Issue Date: ${fmtDate(lpo.issue_date)}`, col2X + 10)
      .text(`Delivery Date: ${fmtDate(lpo.delivery_date)}`, col2X + 10)
      .text(`Payment Terms: ${lpo.payment_terms || 'As agreed'}`, col2X + 10);
    y += infoBoxH + 14;

    // Items table
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(GREEN).text('ORDER ITEMS', pageLeft, y);
    y = doc.y + 4;
    const colWidths = { no: 28, desc: 200, spec: 100, qty: 44, unit: 84, total: 84 };
    doc.rect(pageLeft, y, contentWidth, 22).fillColor(GREEN).fill();
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF');
    let cx = pageLeft + 6;
    doc.text('#', cx, y + 6, { width: colWidths.no }); cx += colWidths.no;
    doc.text('Description', cx, y + 6, { width: colWidths.desc }); cx += colWidths.desc;
    doc.text('Specifications', cx, y + 6, { width: colWidths.spec }); cx += colWidths.spec;
    doc.text('Qty', cx, y + 6, { width: colWidths.qty, align: 'right' }); cx += colWidths.qty + 4;
    doc.text('Unit Price', cx, y + 6, { width: colWidths.unit, align: 'right' }); cx += colWidths.unit + 4;
    doc.text('Total', cx, y + 6, { width: colWidths.total, align: 'right' });
    y += 22;

    lpo.items.forEach((item, idx) => {
      const rowH = 20;
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
      doc.rect(pageLeft, y, contentWidth, rowH).fillColor(bg).fill();
      doc.rect(pageLeft, y, contentWidth, rowH).strokeColor('#E5E7EB').lineWidth(0.2).stroke();
      doc.font('Helvetica').fontSize(8.5).fillColor(DARK);
      cx = pageLeft + 6;
      doc.text(`${idx + 1}`, cx, y + 5, { width: colWidths.no }); cx += colWidths.no;
      doc.text(item.item_name, cx, y + 5, { width: colWidths.desc }); cx += colWidths.desc;
      doc.text(item.specifications || '-', cx, y + 5, { width: colWidths.spec }); cx += colWidths.spec;
      doc.text(String(item.quantity), cx, y + 5, { width: colWidths.qty, align: 'right' }); cx += colWidths.qty + 4;
      doc.text(fmtKES(item.unit_price), cx, y + 5, { width: colWidths.unit, align: 'right' }); cx += colWidths.unit + 4;
      doc.font('Helvetica-Bold').text(fmtKES(item.total_price), cx, y + 5, { width: colWidths.total, align: 'right' });
      y += rowH;
    });

    doc.rect(pageLeft, y, contentWidth, 24).fillColor(GREEN).fill();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#FFFFFF')
      .text('TOTAL AMOUNT', pageLeft + 6, y + 6, { width: contentWidth - colWidths.total - 10 })
      .text(fmtKES(lpo.total_amount), pageLeft + contentWidth - colWidths.total - 4, y + 6, { width: colWidths.total, align: 'right' });
    y += 24 + 14;

    if (lpo.notes) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text('NOTES:', pageLeft, y);
      doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(lpo.notes, pageLeft + 48, y, { width: contentWidth - 48 });
      y = doc.y + 10;
    }

    // T&C
    doc.rect(pageLeft, y, contentWidth, 72).fillColor('#F9FAFB').fill();
    doc.rect(pageLeft, y, contentWidth, 72).strokeColor('#E5E7EB').lineWidth(0.4).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GREEN).text('TERMS & CONDITIONS', pageLeft + 10, y + 8);
    doc.font('Helvetica').fontSize(8).fillColor(DARK);
    [
      '1. Goods/services must conform strictly to the specifications stated above.',
      '2. Delivery must be made to the stated department by the delivery date indicated.',
      '3. This LPO must accompany all deliveries and invoices.',
      '4. NTVC reserves the right to reject substandard goods without obligation.',
      '5. Payment shall be made within 30 days of receipt of goods and a verified invoice.',
    ].forEach((t, i) => doc.text(t, pageLeft + 10, y + 22 + i * 10, { width: contentWidth - 20 }));
    y += 72 + 16;

    // Signature block
    const sigW = (contentWidth - 20) / 2;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text('Prepared by:', pageLeft, y);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text('Approved by:', pageLeft + sigW + 20, y);
    y += 16;
    doc.moveTo(pageLeft, y + 30).lineTo(pageLeft + sigW - 10, y + 30).strokeColor('#9CA3AF').lineWidth(0.5).stroke();
    doc.moveTo(pageLeft + sigW + 20, y + 30).lineTo(pageLeft + contentWidth, y + 30).strokeColor('#9CA3AF').lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(GREY)
      .text('Signature & Date', pageLeft, y + 33)
      .text(lpo.approver ? `${lpo.approver.email}  |  Signature & Date` : 'Signature & Date', pageLeft + sigW + 20, y + 33);
    drawFooter(doc, lpo.lpo_no);
  });
}

async function generateRFQ(rfq) {
  return buildPDF(async (doc) => {
    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const contentWidth = pageRight - pageLeft;
    let y = drawHeader(doc, 'Request for Quotation');

    doc.rect(pageLeft, y, contentWidth, 28).fillColor(GREEN).fill();
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF')
      .text(`RFQ NO: ${rfq.rfq_no}`, pageLeft + 12, y + 7, { continued: true, width: contentWidth / 2 });
    doc.font('Helvetica').fontSize(10).fillColor('#FFFFFF')
      .text(`Status: ${rfq.status}`, { align: 'right', width: contentWidth / 2 - 12 });
    y += 28 + 10;

    const metaH = 68;
    doc.rect(pageLeft, y, contentWidth, metaH).fillColor(BG_YELLOW).fill();
    doc.rect(pageLeft, y, 4, metaH).fillColor('#D97706').fill();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#92400E').text('QUOTATION DETAILS', pageLeft + 14, y + 8);
    [
      ['Title:', rfq.title],
      ['Department:', rfq.requisition?.department?.name || 'N/A'],
      ['Issue Date:', fmtDate(rfq.created_at)],
      ['Closing Date:', fmtDate(rfq.closing_date)],
    ].forEach(([label, val], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const rx = pageLeft + 14 + col * (contentWidth / 2);
      const ry = y + 22 + row * 16;
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(label, rx, ry, { width: 100 });
      doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(val, rx + 103, ry, { width: contentWidth / 2 - 115 });
    });
    y += metaH + 14;

    if (rfq.description) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor(GREEN).text('SCOPE OF WORK / DESCRIPTION', pageLeft, y);
      y = doc.y + 4;
      doc.font('Helvetica').fontSize(10).fillColor(DARK).text(rfq.description, pageLeft, y, { width: contentWidth });
      y = doc.y + 14;
    }

    const items = rfq.requisition?.items || [];
    if (items.length > 0) {
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(GREEN).text('ITEMS REQUIRED', pageLeft, y);
      y = doc.y + 4;
      const cols = { no: 28, name: 170, desc: 130, spec: 120, qty: 40, unit: 52 };
      doc.rect(pageLeft, y, contentWidth, 22).fillColor(GREEN).fill();
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#FFFFFF');
      let cx = pageLeft + 6;
      doc.text('#', cx, y + 6, { width: cols.no }); cx += cols.no;
      doc.text('Item Name', cx, y + 6, { width: cols.name }); cx += cols.name;
      doc.text('Description', cx, y + 6, { width: cols.desc }); cx += cols.desc;
      doc.text('Specifications', cx, y + 6, { width: cols.spec }); cx += cols.spec;
      doc.text('Qty', cx, y + 6, { width: cols.qty, align: 'right' }); cx += cols.qty + 4;
      doc.text('Unit', cx, y + 6, { width: cols.unit });
      y += 22;
      items.forEach((item, idx) => {
        const bg = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
        doc.rect(pageLeft, y, contentWidth, 20).fillColor(bg).fill();
        doc.rect(pageLeft, y, contentWidth, 20).strokeColor('#E5E7EB').lineWidth(0.2).stroke();
        doc.font('Helvetica').fontSize(8.5).fillColor(DARK);
        cx = pageLeft + 6;
        doc.text(`${idx + 1}`, cx, y + 5, { width: cols.no }); cx += cols.no;
        doc.text(item.item_name, cx, y + 5, { width: cols.name }); cx += cols.name;
        doc.text(item.description || '-', cx, y + 5, { width: cols.desc }); cx += cols.desc;
        doc.text(item.specifications || '-', cx, y + 5, { width: cols.spec }); cx += cols.spec;
        doc.text(String(item.quantity), cx, y + 5, { width: cols.qty, align: 'right' }); cx += cols.qty + 4;
        doc.text('Unit', cx, y + 5, { width: cols.unit });
        y += 20;
      });
      y += 14;
    }

    doc.rect(pageLeft, y, contentWidth, 88).fillColor('#F0F9FF').fill();
    doc.rect(pageLeft, y, 4, 88).fillColor('#0EA5E9').fill();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#0369A1').text('INSTRUCTIONS TO BIDDERS', pageLeft + 14, y + 8);
    doc.font('Helvetica').fontSize(8.5).fillColor(DARK);
    [
      `1. Submit your sealed quotation to the Procurement Office by: ${fmtDate(rfq.closing_date)}.`,
      '2. Quote prices inclusive of all taxes, delivery charges, and applicable levies.',
      '3. Validity of your quotation must be for a minimum of 30 days from the closing date.',
      '4. Attach copies of your business registration and tax compliance certificates.',
      '5. NTVC is not bound to accept the lowest or any quotation received.',
      '6. Late submissions will not be considered under any circumstances.',
    ].forEach((inst, i) => doc.text(inst, pageLeft + 14, y + 24 + i * 11, { width: contentWidth - 28 }));
    y += 88 + 14;

    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text('Issued by:', pageLeft, y);
    y += 36;
    doc.moveTo(pageLeft, y).lineTo(pageLeft + 200, y).strokeColor('#9CA3AF').lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text('Procurement Officer — NTVC  |  Signature & Date', pageLeft, y + 4);
    drawFooter(doc, rfq.rfq_no);
  });
}

async function generateGRN(grn) {
  return buildPDF(async (doc) => {
    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const contentWidth = pageRight - pageLeft;
    let y = drawHeader(doc, 'Goods Received Note');

    doc.rect(pageLeft, y, contentWidth, 28).fillColor(GREEN).fill();
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF')
      .text(`GRN NO: ${grn.grn_no}`, pageLeft + 12, y + 7, { continued: true, width: contentWidth / 2 });
    doc.font('Helvetica').fontSize(10).fillColor('#FFFFFF')
      .text(`Status: ${grn.status}`, { align: 'right', width: contentWidth / 2 - 12 });
    y += 28 + 10;

    const metaH = 56;
    doc.rect(pageLeft, y, contentWidth, metaH).fillColor('#F9FAFB').fill();
    doc.rect(pageLeft, y, contentWidth, metaH).strokeColor('#E5E7EB').lineWidth(0.4).stroke();
    [
      ['LPO Reference:', grn.lpo?.lpo_no || 'N/A'],
      ['Supplier:', grn.lpo?.supplier?.name || 'N/A'],
      ['Received Date:', fmtDate(grn.received_date)],
      ['Department:', grn.lpo?.department?.name || 'N/A'],
    ].forEach(([label, val], i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const rx = pageLeft + 14 + col * (contentWidth / 2);
      const ry = y + 10 + row * 18;
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text(label, rx, ry, { width: 130 });
      doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(val, rx + 133, ry, { width: contentWidth / 2 - 145 });
    });
    y += metaH + 14;

    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(GREEN).text('ITEMS RECEIVED', pageLeft, y);
    y = doc.y + 4;
    const cols = { no: 24, name: 155, ordered: 62, received: 62, accepted: 62, cond: 78, notes: 97 };
    doc.rect(pageLeft, y, contentWidth, 22).fillColor(GREEN).fill();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#FFFFFF');
    let cx = pageLeft + 4;
    doc.text('#', cx, y + 6, { width: cols.no }); cx += cols.no;
    doc.text('Item Name', cx, y + 6, { width: cols.name }); cx += cols.name;
    doc.text('Ordered', cx, y + 6, { width: cols.ordered, align: 'right' }); cx += cols.ordered + 4;
    doc.text('Received', cx, y + 6, { width: cols.received, align: 'right' }); cx += cols.received + 4;
    doc.text('Accepted', cx, y + 6, { width: cols.accepted, align: 'right' }); cx += cols.accepted + 4;
    doc.text('Condition', cx, y + 6, { width: cols.cond }); cx += cols.cond;
    doc.text('Notes', cx, y + 6, { width: cols.notes });
    y += 22;

    (grn.items || []).forEach((item, idx) => {
      const bg = idx % 2 === 0 ? '#FFFFFF' : '#F9FAFB';
      doc.rect(pageLeft, y, contentWidth, 20).fillColor(bg).fill();
      doc.rect(pageLeft, y, contentWidth, 20).strokeColor('#E5E7EB').lineWidth(0.2).stroke();
      doc.font('Helvetica').fontSize(8.5).fillColor(DARK);
      cx = pageLeft + 4;
      doc.text(`${idx + 1}`, cx, y + 5, { width: cols.no }); cx += cols.no;
      doc.text(item.item_name, cx, y + 5, { width: cols.name }); cx += cols.name;
      doc.text(String(item.quantity_ordered), cx, y + 5, { width: cols.ordered, align: 'right' }); cx += cols.ordered + 4;
      doc.text(String(item.quantity_received), cx, y + 5, { width: cols.received, align: 'right' }); cx += cols.received + 4;
      doc.text(String(item.quantity_accepted), cx, y + 5, { width: cols.accepted, align: 'right' }); cx += cols.accepted + 4;
      doc.text(item.condition || '-', cx, y + 5, { width: cols.cond }); cx += cols.cond;
      doc.text(item.notes || '-', cx, y + 5, { width: cols.notes });
      y += 20;
    });
    y += 14;

    if (grn.notes) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text('Notes / Discrepancies:', pageLeft, y);
      doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(grn.notes, pageLeft, doc.y, { width: contentWidth });
      y = doc.y + 10;
    }

    y += 16;
    const sigW = (contentWidth - 20) / 2;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK)
      .text('Received by:', pageLeft, y)
      .text('Verified by:', pageLeft + sigW + 20, y);
    y += 36;
    doc.moveTo(pageLeft, y).lineTo(pageLeft + sigW - 10, y).strokeColor('#9CA3AF').lineWidth(0.5).stroke();
    doc.moveTo(pageLeft + sigW + 20, y).lineTo(pageLeft + contentWidth, y).strokeColor('#9CA3AF').lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(GREY)
      .text('Name, Signature & Date', pageLeft, y + 4)
      .text('Name, Signature & Date', pageLeft + sigW + 20, y + 4);
    drawFooter(doc, grn.grn_no);
  });
}

async function generateSupplierInvoice(invoice) {
  return buildPDF(async (doc) => {
    const pageLeft = doc.page.margins.left;
    const pageRight = doc.page.width - doc.page.margins.right;
    const contentWidth = pageRight - pageLeft;
    let y = drawHeader(doc, 'Supplier Invoice');

    doc.rect(pageLeft, y, contentWidth, 28).fillColor(GREEN).fill();
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#FFFFFF')
      .text(`INVOICE NO: ${invoice.invoice_no}`, pageLeft + 12, y + 7, { continued: true, width: contentWidth / 2 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor(invoice.status === 'PAID' ? '#22C55E' : invoice.status === 'PARTIAL' ? '#F59E0B' : '#EF4444')
      .text(`● ${invoice.status}`, { align: 'right', width: contentWidth / 2 - 12 });
    y += 28 + 10;

    const colW = (contentWidth - 10) / 2;
    const col2X = pageLeft + colW + 10;
    const infoH = 84;
    doc.rect(pageLeft, y, colW, infoH).fillColor('#F9FAFB').fill();
    doc.rect(pageLeft, y, colW, infoH).strokeColor('#E5E7EB').lineWidth(0.4).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GREEN).text('FROM (SUPPLIER)', pageLeft + 10, y + 8);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(DARK).text(invoice.supplier?.name || invoice.lpo?.supplier?.name || 'N/A', pageLeft + 10, y + 22);
    doc.font('Helvetica').fontSize(9).fillColor(GREY)
      .text(invoice.supplier?.contact_person ? `Attn: ${invoice.supplier.contact_person}` : '', pageLeft + 10, doc.y)
      .text(invoice.supplier?.phone || '', pageLeft + 10)
      .text(invoice.supplier?.email || '', pageLeft + 10);

    doc.rect(col2X, y, colW, infoH).fillColor('#F9FAFB').fill();
    doc.rect(col2X, y, colW, infoH).strokeColor('#E5E7EB').lineWidth(0.4).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GREEN).text('INVOICE DETAILS', col2X + 10, y + 8);
    doc.font('Helvetica').fontSize(9).fillColor(DARK)
      .text(`Invoice Date:   ${fmtDate(invoice.invoice_date)}`, col2X + 10, y + 22)
      .text(`Due Date:       ${fmtDate(invoice.due_date)}`, col2X + 10)
      .text(`LPO Reference:  ${invoice.lpo?.lpo_no || 'N/A'}`, col2X + 10)
      .text(`Department:     ${invoice.lpo?.department?.name || 'N/A'}`, col2X + 10);
    y += infoH + 14;

    const isPaid = invoice.status === 'PAID';
    const sumH = 3 * 26 + 20;
    doc.rect(pageLeft, y, contentWidth, sumH).fillColor(isPaid ? BG_GREEN : BG_RED).fill();
    doc.rect(pageLeft, y, 4, sumH).fillColor(isPaid ? GREEN : '#EF4444').fill();
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(isPaid ? GREEN : '#B91C1C').text('PAYMENT SUMMARY', pageLeft + 14, y + 8);
    [
      ['Invoice Amount:', fmtKES(invoice.amount)],
      ['Amount Paid:', fmtKES(invoice.paid_amount)],
      ['Balance Due:', fmtKES(invoice.amount - invoice.paid_amount)],
    ].forEach(([label, val], i) => {
      const ry = y + 24 + i * 26;
      doc.font('Helvetica-Bold').fontSize(11).fillColor(DARK).text(label, pageLeft + 14, ry, { width: 200 });
      doc.font('Helvetica-Bold').fontSize(13).fillColor(i === 2 ? (isPaid ? GREEN : '#B91C1C') : DARK)
        .text(val, pageLeft + 220, ry, { width: contentWidth - 230, align: 'right' });
    });
    y += sumH + 16;

    if (invoice.notes) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(DARK).text('Notes:', pageLeft, y);
      doc.font('Helvetica').fontSize(9.5).fillColor(GREY).text(invoice.notes, pageLeft + 48, y, { width: contentWidth - 48 });
      y = doc.y + 10;
    }

    doc.rect(pageLeft, y, contentWidth, 36).fillColor(BG_YELLOW).fill();
    doc.rect(pageLeft, y, 4, 36).fillColor('#D97706').fill();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#92400E').text('PAYMENT INFORMATION', pageLeft + 14, y + 6);
    doc.font('Helvetica').fontSize(8.5).fillColor(DARK)
      .text('Payment to be made to: North Horr TVC Finance Office  |  Bank Transfer / M-Pesa  |  Quote invoice number on all payments.', pageLeft + 14, y + 20, { width: contentWidth - 28 });
    y += 36 + 20;

    const sigW2 = (contentWidth - 20) / 2;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK).text('Received by (Finance):', pageLeft, y);
    y += 36;
    doc.moveTo(pageLeft, y).lineTo(pageLeft + sigW2 - 10, y).strokeColor('#9CA3AF').lineWidth(0.5).stroke();
    doc.font('Helvetica').fontSize(8).fillColor(GREY).text('Name, Signature & Date', pageLeft, y + 4);
    drawFooter(doc, invoice.invoice_no);
  });
}

module.exports = {
  generateAdmissionLetter,
  generateLetterOfAcceptance,
  generateAdmissionForTraining,
  generateFeeStructure,
  generateStudentPersonalInfo,
  generateLPO,
  generateRFQ,
  generateGRN,
  generateSupplierInvoice,
};


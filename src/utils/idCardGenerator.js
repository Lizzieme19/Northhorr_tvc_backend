const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');
const QRCode = require('qrcode');
const prisma = require('../config/db');
const path = require('path');

// ---------------------------------------------------------------------------
// Asset paths - these files already exist in /app/public
// ---------------------------------------------------------------------------
const MINISTRY_PATH = path.join(__dirname, '../../public/Ministry.png'); // top-left
const LOGO_PATH = path.join(__dirname, '../../public/logo.png'); // top-right
const PLACEHOLDER_PHOTO_URL =
  process.env.ID_CARD_PLACEHOLDER_PHOTO || 'https://via.placeholder.com/132x168?text=No+Photo';

// Card dimensions (matching the HTML template)
const CARD_WIDTH = 650;
const CARD_HEIGHT = 400;
const BORDER_WIDTH = 4;
const BORDER_COLOR = '#1a7a3d';
const ACCENT_COLOR = '#2d8a2d';
const FIELD_LABEL_COLOR = '#7a2d1f';
const FIELD_VALUE_COLOR = '#222222';

// Layout constants
const CONTENT_LEFT = 18;
const CONTENT_RIGHT = CARD_WIDTH - 18;
const CONTENT_TOP = 14;
const HEADER_HEIGHT = 70;
const HEADER_BOTTOM = CONTENT_TOP + HEADER_HEIGHT;
const LOGO_SIZE = 62;
const LOGO_Y = CONTENT_TOP;

// Photo block
const PHOTO_X = CONTENT_LEFT;
const PHOTO_Y = HEADER_BOTTOM + 22;
const PHOTO_W = 132;
const PHOTO_H = 168;

// Info column
const INFO_X = PHOTO_X + PHOTO_W + 22;
const INFO_WIDTH = CONTENT_RIGHT - INFO_X;

// Bottom banner
const BANNER_HEIGHT = 35;
const BANNER_Y = CARD_HEIGHT - BANNER_HEIGHT;

/**
 * Fetch student data for ID card generation
 */
async function getStudentData(studentId) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: {
      application: {
        select: {
          surname: true,
          other_names: true,
          gender: true,
          id_number: true,
        },
      },
      course: {
        select: {
          name: true,
          shortcode: true,
        },
      },
      department: {
        select: {
          name: true,
          shortcode: true,
        },
      },
    },
  });

  if (!student) {
    throw new Error('Student not found');
  }

  return student;
}

/**
 * Generate QR code for student
 */
async function generateQRCode(admissionNo) {
  try {
    return await QRCode.toDataURL(admissionNo, {
      width: 52,
      margin: 0,
      errorCorrectionLevel: 'L',
    });
  } catch (error) {
    console.error('QR code generation error:', error);
    return null;
  }
}

/**
 * Format expiry date for display
 */
function formatExpiryDate(date) {
  if (!date) return 'N/A';
  const d = new Date(date);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Draw rounded rectangle
 */
function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * Draw a circular placeholder badge for missing images
 */
function drawBadgePlaceholder(ctx, x, y, size, label) {
  const r = size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
  ctx.fillStyle = '#eef5ee';
  ctx.fill();
  ctx.strokeStyle = ACCENT_COLOR;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = ACCENT_COLOR;
  ctx.font = `bold ${Math.round(size * 0.22)}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + r, y + r);
  ctx.restore();
}

/**
 * Safely load a local image
 */
async function safeLoadImage(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[ID card] ${label} not found at ${filePath} - using placeholder`);
    return null;
  }
  try {
    return await loadImage(filePath);
  } catch (err) {
    console.warn(`[ID card] Failed to load ${label}: ${err.message} - using placeholder`);
    return null;
  }
}

/**
 * Generate ID card as PNG buffer using Canvas
 */
async function generateIDCard(studentId) {
  try {
    console.log('Starting ID card generation for student:', studentId);

    // Fetch student data
    const student = await getStudentData(studentId);
    console.log('Student data fetched:', student.admission_no);

    // Generate QR code
    const qrCodeData = await generateQRCode(student.admission_no);
    console.log('QR code generated');

    // Create canvas
    const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const ctx = canvas.getContext('2d');

    const { application, course, department } = student;
    const fullName = `${application.surname} ${application.other_names}`;
    const photoUrl = student.profile_picture_url || PLACEHOLDER_PHOTO_URL;
    const idNumber = application.id_number || 'N/A';
    const expiryDate = student.id_card_expiry_date
      ? formatExpiryDate(student.id_card_expiry_date)
      : 'N/A';

    // ---- Background ----
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // ---- Border ----
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = BORDER_WIDTH;
    drawRoundedRect(ctx, BORDER_WIDTH / 2, BORDER_WIDTH / 2, CARD_WIDTH - BORDER_WIDTH, CARD_HEIGHT - BORDER_WIDTH, 18);
    ctx.stroke();

    // ---- Header: Ministry logo (left) + titles + School logo (right) ----
    const ministryImg = await safeLoadImage(MINISTRY_PATH, 'Ministry logo');
    const ministryX = CONTENT_LEFT;
    if (ministryImg) {
      ctx.drawImage(ministryImg, ministryX, LOGO_Y, LOGO_SIZE, LOGO_SIZE);
    } else {
      drawBadgePlaceholder(ctx, ministryX, LOGO_Y, LOGO_SIZE, 'MOE');
    }

    const schoolImg = await safeLoadImage(LOGO_PATH, 'School logo');
    const schoolX = CONTENT_RIGHT - LOGO_SIZE;
    if (schoolImg) {
      ctx.drawImage(schoolImg, schoolX, LOGO_Y, LOGO_SIZE, LOGO_SIZE);
    } else {
      drawBadgePlaceholder(ctx, schoolX, LOGO_Y, LOGO_SIZE, 'NHTVC');
    }

    // Header text (centered)
    const textLeft = ministryX + LOGO_SIZE + 10;
    const textRight = schoolX - 10;
    const headerCenterX = (textLeft + textRight) / 2;

    ctx.fillStyle = '#1a1a1a';
    ctx.textAlign = 'center';
    ctx.font = 'bold 11.5px Arial';
    ctx.fillText('MINISTRY OF EDUCATION STATE DEPARTMENT', headerCenterX, CONTENT_TOP + 20);
    ctx.fillText('FOR VOCATIONAL AND TECHNICAL TRAINING', headerCenterX, CONTENT_TOP + 35);
    ctx.font = 'bold 15px Arial';
    ctx.fillStyle = ACCENT_COLOR;
    ctx.fillText('NORTH HORR TECHNICAL & VOCATIONAL COLLEGE', headerCenterX, CONTENT_TOP + 55);

    // ---- Name ----
    const nameY = HEADER_BOTTOM + 12;
    ctx.fillStyle = '#111111';
    ctx.font = 'bold 21px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(fullName.toUpperCase(), CONTENT_LEFT, nameY);

    // ---- Photo ----
    try {
      const photo = await loadImage(photoUrl);
      ctx.save();
      drawRoundedRect(ctx, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, 10);
      ctx.clip();
      ctx.drawImage(photo, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H);
      ctx.restore();
      ctx.strokeStyle = BORDER_COLOR;
      ctx.lineWidth = 3;
      drawRoundedRect(ctx, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, 10);
      ctx.stroke();
    } catch (err) {
      console.error('Failed to load photo:', err);
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H);
      ctx.strokeStyle = BORDER_COLOR;
      ctx.lineWidth = 3;
      drawRoundedRect(ctx, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, 10);
      ctx.stroke();
      ctx.fillStyle = ACCENT_COLOR;
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('NO PHOTO', PHOTO_X + PHOTO_W / 2, PHOTO_Y + PHOTO_H / 2);
    }

    // ---- Fields ----
    const fieldY = PHOTO_Y + 20;
    const fieldSpacing = 20;
    const labelX = INFO_X;
    const valueX = INFO_X + 78;

    const fields = [
      ['Adm No:', student.admission_no],
      ['Dept:', department.name],
      ['Course:', course.name],
      ['Gender:', application.gender],
      ['ID No:', idNumber],
      ['Expiry:', expiryDate],
    ];

    fields.forEach(([label, value], i) => {
      const y = fieldY + i * fieldSpacing;
      ctx.fillStyle = FIELD_LABEL_COLOR;
      ctx.font = 'bold 15px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(label, labelX, y);
      ctx.fillStyle = FIELD_VALUE_COLOR;
      ctx.font = '15px Arial';
      ctx.fillText(String(value), valueX, y);
    });

    // ---- QR Code ----
    if (qrCodeData) {
      try {
        const qrImage = await loadImage(qrCodeData);
        const qrX = CONTENT_RIGHT - 52 - 4;
        const qrY = PHOTO_Y + PHOTO_H - 52 - 4;
        ctx.drawImage(qrImage, qrX, qrY, 52, 52);
      } catch (err) {
        console.error('Failed to load QR code:', err);
      }
    }

    // ---- Bottom Banner ----
    ctx.fillStyle = BORDER_COLOR;
    ctx.fillRect(0, BANNER_Y, CARD_WIDTH, BANNER_HEIGHT);
    ctx.fillStyle = '#7a1f1f';
    ctx.font = 'bold 17px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('STUDENT IDENTIFICATION CARD', CARD_WIDTH / 2, BANNER_Y + 22);

    console.log('ID card generated successfully');
    return canvas.toBuffer('image/png');
  } catch (error) {
    console.error('ID card generation error:', error);
    throw error;
  }
}

/**
 * Generate ID card and save to file
 */
async function generateAndSaveIDCard(studentId, outputPath) {
  const buffer = await generateIDCard(studentId);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

/**
 * Bulk generate ID cards for multiple students
 */
async function bulkGenerateIDCards(studentIds, outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const results = [];
  for (const studentId of studentIds) {
    try {
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: { admission_no: true },
      });

      if (!student) {
        results.push({ studentId, success: false, error: 'Student not found' });
        continue;
      }

      const outputPath = path.join(outputDir, `${student.admission_no}.png`);
      await generateAndSaveIDCard(studentId, outputPath);
      results.push({ studentId, success: true, path: outputPath });
    } catch (error) {
      results.push({ studentId, success: false, error: error.message });
    }
  }

  return results;
}

/**
 * Generate ID cards for all active students
 */
async function generateAllActiveIDCards(outputDir) {
  const students = await prisma.student.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  const studentIds = students.map((s) => s.id);
  return bulkGenerateIDCards(studentIds, outputDir);
}

module.exports = {
  generateIDCard,
  generateAndSaveIDCard,
  bulkGenerateIDCards,
  generateAllActiveIDCards,
};

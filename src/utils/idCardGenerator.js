const fs = require('fs');
const { createCanvas, loadImage } = require('canvas');
const QRCode = require('qrcode');
const prisma = require('../config/db');
const path = require('path');

// ---------------------------------------------------------------------------
// Asset paths (local files)
// ---------------------------------------------------------------------------
const LOGO_PATH = path.join(__dirname, '../../public/logo.png');       // school badge (top-right)
const MINISTRY_PATH = path.join(__dirname, '../../public/Ministry.png'); // ministry/coat of arms (top-left)
const SEAL_PATH = path.join(__dirname, '../../public/seal.png');
const PLACEHOLDER_PHOTO_URL =
  process.env.ID_CARD_PLACEHOLDER_PHOTO || 'https://via.placeholder.com/140x185.png?text=No+Photo';

// ---------------------------------------------------------------------------
// Card layout constants
// Every position below is derived from a small set of numbers so the layout
// stays consistent and nothing can silently overlap.
// ---------------------------------------------------------------------------
const CARD_WIDTH = 750;
const CARD_HEIGHT = 480;

const BORDER_WIDTH = 8;
const BORDER_COLOR = '#1a5a1a';
const ACCENT_COLOR = '#2d8a2d';
const BANNER_WIDTH = 40;

const FIELD_LABEL_COLOR = '#1a5a1a';
const FIELD_VALUE_COLOR = '#333333';

// Safe content box (inside border + banner, with a margin on every side)
const CONTENT_LEFT = BORDER_WIDTH + BANNER_WIDTH + 18; // 66
const CONTENT_RIGHT = CARD_WIDTH - BORDER_WIDTH - 18; // 724
const CONTENT_BOTTOM = CARD_HEIGHT - BORDER_WIDTH - 12; // 460

// Header band
const HEADER_TOP = BORDER_WIDTH + 8; // 16
const HEADER_HEIGHT = 88;
const HEADER_BOTTOM = HEADER_TOP + HEADER_HEIGHT; // 104
const LOGO_SIZE = 52;
const LOGO_Y = HEADER_TOP + 12; // 28

// Photo block
const PHOTO_X = CONTENT_LEFT; // 66
const PHOTO_Y = HEADER_BOTTOM + 20; // 124
const PHOTO_W = 140;
const PHOTO_H = 185; // bottom = 309

// Info column (name + fields), to the right of the photo
const INFO_X = PHOTO_X + PHOTO_W + 26; // 232
const INFO_RIGHT = CONTENT_RIGHT; // 724
const INFO_WIDTH = INFO_RIGHT - INFO_X; // 492

// Footer row (seal + QR)
const SEAL_SIZE = 60;
const QR_SIZE = 66;
const FOOTER_TOP = 360; // safely below both the photo (309) and the last field (~345)

module.exports.__layout = {
  CARD_WIDTH, CARD_HEIGHT, HEADER_BOTTOM, PHOTO_Y, PHOTO_H, FOOTER_TOP,
}; // exported only for layout sanity checks / tests, harmless in production

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
      width: 80,
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
 * Draw text with vertical rotation
 */
function drawVerticalText(ctx, text, x, y, fontSize, fontWeight) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 2);
  ctx.font = `${fontWeight} ${fontSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * Draw a clean circular placeholder badge (used whenever a logo/seal image
 * fails to load, so we never leave a blank gap or a broken-image icon).
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
 * Safely load a local image asset, returning null (and logging a clear
 * warning) instead of throwing if the file is missing or corrupt.
 */
async function safeLoadLocalImage(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.warn(`[ID card] ${label} asset not found at ${filePath} - using placeholder`);
    return null;
  }
  try {
    return await loadImage(filePath);
  } catch (err) {
    console.warn(`[ID card] ${label} asset failed to load (${filePath}): ${err.message} - using placeholder`);
    return null;
  }
}

/**
 * Generate ID card as PNG buffer using Canvas
 */
async function generateIDCard(studentId) {
  try {
    console.log('Starting ID card generation for student:', studentId);
    console.log('>>> RUNNING UPDATED idCardGenerator v2 <<<');

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

    // ---- Borders ----
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = BORDER_WIDTH;
    drawRoundedRect(ctx, BORDER_WIDTH / 2, BORDER_WIDTH / 2, CARD_WIDTH - BORDER_WIDTH, CARD_HEIGHT - BORDER_WIDTH, 20);
    ctx.stroke();

    ctx.strokeStyle = ACCENT_COLOR;
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, BORDER_WIDTH / 2 + 4, BORDER_WIDTH / 2 + 4, CARD_WIDTH - BORDER_WIDTH - 8, CARD_HEIGHT - BORDER_WIDTH - 8, 18);
    ctx.stroke();

    // ---- Side banner ----
    const bannerGradient = ctx.createLinearGradient(BORDER_WIDTH, 0, BORDER_WIDTH + BANNER_WIDTH, 0);
    bannerGradient.addColorStop(0, '#1a5a1a');
    bannerGradient.addColorStop(0.5, '#2d8a2d');
    bannerGradient.addColorStop(1, '#1a5a1a');
    ctx.fillStyle = bannerGradient;
    ctx.fillRect(BORDER_WIDTH, BORDER_WIDTH, BANNER_WIDTH, CARD_HEIGHT - BORDER_WIDTH * 2);

    ctx.fillStyle = '#ffffff';
    drawVerticalText(ctx, 'STUDENT', BORDER_WIDTH + BANNER_WIDTH / 2, CARD_HEIGHT / 2 - 55, 15, 'bold');
    drawVerticalText(ctx, 'ID CARD', BORDER_WIDTH + BANNER_WIDTH / 2, CARD_HEIGHT / 2 + 55, 15, 'bold');

    // ---- Header: Ministry logo (left) + text + School logo (right) ----
    const ministryImg = await safeLoadLocalImage(MINISTRY_PATH, 'Ministry logo');
    const ministryX = CONTENT_LEFT;
    if (ministryImg) {
      ctx.drawImage(ministryImg, ministryX, LOGO_Y, LOGO_SIZE, LOGO_SIZE);
    } else {
      drawBadgePlaceholder(ctx, ministryX, LOGO_Y, LOGO_SIZE, 'MOE');
    }

    const schoolImg = await safeLoadLocalImage(LOGO_PATH, 'School logo');
    const schoolX = CONTENT_RIGHT - LOGO_SIZE;
    if (schoolImg) {
      ctx.drawImage(schoolImg, schoolX, LOGO_Y, LOGO_SIZE, LOGO_SIZE);
    } else {
      drawBadgePlaceholder(ctx, schoolX, LOGO_Y, LOGO_SIZE, 'NHTVC');
    }

    // Header text, centered strictly between the two logos so it can never
    // collide with either one.
    const textLeft = ministryX + LOGO_SIZE + 14;
    const textRight = schoolX - 14;
    const headerCenterX = (textLeft + textRight) / 2;

    ctx.fillStyle = BORDER_COLOR;
    ctx.textAlign = 'center';
    ctx.font = 'bold 11px Arial';
    ctx.fillText('MINISTRY OF EDUCATION', headerCenterX, HEADER_TOP + 30);
    ctx.fillText('STATE DEPARTMENT FOR VOCATIONAL & TECHNICAL TRAINING', headerCenterX, HEADER_TOP + 44);
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = ACCENT_COLOR;
    ctx.fillText('NORTH HORR TECHNICAL & VOCATIONAL COLLEGE', headerCenterX, HEADER_TOP + 66);

    // Header separator line
    ctx.strokeStyle = ACCENT_COLOR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CONTENT_LEFT, HEADER_BOTTOM);
    ctx.lineTo(CONTENT_RIGHT, HEADER_BOTTOM);
    ctx.stroke();

    // ---- Photo ----
    try {
      const photo = await loadImage(photoUrl);
      ctx.save();
      drawRoundedRect(ctx, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, 10);
      ctx.clip();
      ctx.drawImage(photo, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H);
      ctx.restore();
      ctx.strokeStyle = ACCENT_COLOR;
      ctx.lineWidth = 3;
      drawRoundedRect(ctx, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, 10);
      ctx.stroke();
    } catch (err) {
      console.error('Failed to load photo:', err);
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H);
      ctx.strokeStyle = ACCENT_COLOR;
      ctx.lineWidth = 3;
      drawRoundedRect(ctx, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, 10);
      ctx.stroke();
      ctx.fillStyle = ACCENT_COLOR;
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('NO PHOTO', PHOTO_X + PHOTO_W / 2, PHOTO_Y + PHOTO_H / 2);
    }

    // ---- Name + fields ----
    ctx.fillStyle = BORDER_COLOR;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(fullName.toUpperCase(), INFO_X, PHOTO_Y + 20);

    ctx.strokeStyle = ACCENT_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(INFO_X, PHOTO_Y + 34);
    ctx.lineTo(INFO_X + INFO_WIDTH, PHOTO_Y + 34);
    ctx.stroke();

    const fields = [
      ['Adm No:', student.admission_no],
      ['Dept:', department.name],
      ['Course:', course.name],
      ['Gender:', application.gender],
      ['ID No:', idNumber],
      ['Expiry:', expiryDate],
    ];
    const fieldStartY = PHOTO_Y + 64;
    const fieldSpacing = 31;
    const labelX = INFO_X;
    const valueX = INFO_X + 100;

    fields.forEach(([label, value], i) => {
      const y = fieldStartY + i * fieldSpacing;
      ctx.fillStyle = FIELD_LABEL_COLOR;
      ctx.font = 'bold 15px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(label, labelX, y);
      ctx.fillStyle = FIELD_VALUE_COLOR;
      ctx.font = '15px Arial';
      ctx.fillText(String(value), valueX, y);
    });

    // ---- Footer: seal (under photo) + QR (under info column) ----
    const sealImg = await safeLoadLocalImage(SEAL_PATH, 'Seal');
    const sealX = PHOTO_X + (PHOTO_W - SEAL_SIZE) / 2;
    if (sealImg) {
      ctx.drawImage(sealImg, sealX, FOOTER_TOP, SEAL_SIZE, SEAL_SIZE);
    } else {
      drawBadgePlaceholder(ctx, sealX, FOOTER_TOP, SEAL_SIZE, 'SEAL');
    }

    if (qrCodeData) {
      try {
        const qrImage = await loadImage(qrCodeData);
        const qrX = INFO_X + INFO_WIDTH - QR_SIZE;
        ctx.drawImage(qrImage, qrX, FOOTER_TOP, QR_SIZE, QR_SIZE);
      } catch (err) {
        console.error('Failed to load QR code:', err);
      }
    }

    // ---- Footer rule + validity note (fills the bottom strip on purpose) ----
    const footerRuleY = FOOTER_TOP + Math.max(SEAL_SIZE, QR_SIZE) + 14;
    ctx.strokeStyle = '#cfe3cf';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(CONTENT_LEFT, footerRuleY);
    ctx.lineTo(CONTENT_RIGHT, footerRuleY);
    ctx.stroke();

    ctx.fillStyle = '#777777';
    ctx.font = 'italic 10px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(
      'This card is the property of North Horr Technical & Vocational College. If found, please return.',
      CARD_WIDTH / 2,
      Math.min(footerRuleY + 16, CONTENT_BOTTOM)
    );

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

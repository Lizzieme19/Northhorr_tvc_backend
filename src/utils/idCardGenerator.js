const { createCanvas, loadImage } = require('canvas');
const QRCode = require('qrcode');
const prisma = require('../config/db');
const path = require('path');

// Asset paths (local files)
const LOGO_PATH = path.join(__dirname, '../../public/logo.png');
const MINISTRY_PATH = path.join(__dirname, '../../public/Ministry.png');
const SEAL_PATH = path.join(__dirname, '../../public/seal.png');
const PLACEHOLDER_PHOTO_URL = process.env.ID_CARD_PLACEHOLDER_PHOTO || 'https://via.placeholder.com/120x140?text=No+Photo';

// Card dimensions
const CARD_WIDTH = 700;
const CARD_HEIGHT = 450;
const BORDER_WIDTH = 8;
const BORDER_COLOR = '#1a5a1a';
const BANNER_WIDTH = 40;
const HEADER_BG_COLOR = '#ffffff';
const FIELD_LABEL_COLOR = '#1a5a1a';
const FIELD_VALUE_COLOR = '#333333';
const ACCENT_COLOR = '#2d8a2d';

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
      width: 50,
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

    // Draw white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // Draw outer border
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = BORDER_WIDTH;
    drawRoundedRect(ctx, BORDER_WIDTH/2, BORDER_WIDTH/2, CARD_WIDTH - BORDER_WIDTH, CARD_HEIGHT - BORDER_WIDTH, 20);
    ctx.stroke();

    // Draw inner border
    ctx.strokeStyle = ACCENT_COLOR;
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, BORDER_WIDTH/2 + 4, BORDER_WIDTH/2 + 4, CARD_WIDTH - BORDER_WIDTH - 8, CARD_HEIGHT - BORDER_WIDTH - 8, 18);
    ctx.stroke();

    // Draw side banner with gradient
    const bannerGradient = ctx.createLinearGradient(BORDER_WIDTH, 0, BORDER_WIDTH + BANNER_WIDTH, 0);
    bannerGradient.addColorStop(0, '#1a5a1a');
    bannerGradient.addColorStop(0.5, '#2d8a2d');
    bannerGradient.addColorStop(1, '#1a5a1a');
    ctx.fillStyle = bannerGradient;
    ctx.fillRect(BORDER_WIDTH, BORDER_WIDTH, BANNER_WIDTH, CARD_HEIGHT - BORDER_WIDTH * 2);

    // Draw vertical text in banner
    ctx.fillStyle = '#ffffff';
    drawVerticalText(ctx, 'STUDENT', BORDER_WIDTH + BANNER_WIDTH/2, CARD_HEIGHT/2 - 25, 16, 'bold');
    drawVerticalText(ctx, 'ID CARD', BORDER_WIDTH + BANNER_WIDTH/2, CARD_HEIGHT/2 + 25, 16, 'bold');

    // Draw header section
    const headerY = 15;
    const headerHeight = 80;

    // Load and draw logo (left side)
    try {
      const logo = await loadImage(LOGO_PATH);
      ctx.drawImage(logo, BORDER_WIDTH + BANNER_WIDTH + 20, headerY + 10, 60, 60);
    } catch (err) {
      console.error('Failed to load logo:', err);
    }

    // Load and draw Ministry logo (right side)
    try {
      const ministry = await loadImage(MINISTRY_PATH);
      ctx.drawImage(ministry, CARD_WIDTH - BORDER_WIDTH - 80, headerY + 10, 60, 60);
    } catch (err) {
      console.error('Failed to load Ministry logo:', err);
    }

    // Draw header text (centered)
    ctx.fillStyle = BORDER_COLOR;
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    const headerCenterX = BORDER_WIDTH + BANNER_WIDTH + (CARD_WIDTH - BORDER_WIDTH * 2 - BANNER_WIDTH) / 2;
    ctx.fillText('MINISTRY OF EDUCATION', headerCenterX, headerY + 20);
    ctx.fillText('STATE DEPARTMENT FOR VOCATIONAL & TECHNICAL TRAINING', headerCenterX, headerY + 35);
    ctx.font = 'bold 13px Arial';
    ctx.fillStyle = ACCENT_COLOR;
    ctx.fillText('NORTH HORR TECHNICAL & VOCATIONAL COLLEGE', headerCenterX, headerY + 55);

    // Draw header separator line
    ctx.strokeStyle = ACCENT_COLOR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(BORDER_WIDTH + BANNER_WIDTH + 15, headerY + headerHeight);
    ctx.lineTo(CARD_WIDTH - BORDER_WIDTH - 15, headerY + headerHeight);
    ctx.stroke();

    // Draw content area
    const contentY = headerY + headerHeight + 20;
    const contentWidth = CARD_WIDTH - BORDER_WIDTH * 2 - BANNER_WIDTH - 30;
    const contentX = BORDER_WIDTH + BANNER_WIDTH + 15;

    // Draw photo on the right side
    const photoWidth = 130;
    const photoHeight = 160;
    const photoX = CARD_WIDTH - BORDER_WIDTH - photoWidth - 20;
    const photoY = contentY;

    try {
      const photo = await loadImage(photoUrl);
      ctx.save();
      drawRoundedRect(ctx, photoX, photoY, photoWidth, photoHeight, 10);
      ctx.clip();
      ctx.drawImage(photo, photoX, photoY, photoWidth, photoHeight);
      ctx.restore();
      ctx.strokeStyle = ACCENT_COLOR;
      ctx.lineWidth = 3;
      drawRoundedRect(ctx, photoX, photoY, photoWidth, photoHeight, 10);
      ctx.stroke();
    } catch (err) {
      console.error('Failed to load photo:', err);
      ctx.fillStyle = '#f5f5f5';
      ctx.fillRect(photoX, photoY, photoWidth, photoHeight);
      ctx.strokeStyle = ACCENT_COLOR;
      ctx.lineWidth = 3;
      drawRoundedRect(ctx, photoX, photoY, photoWidth, photoHeight, 10);
      ctx.stroke();
      ctx.fillStyle = ACCENT_COLOR;
      ctx.font = 'bold 14px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('NO PHOTO', photoX + photoWidth/2, photoY + photoHeight/2);
    }

    // Draw student information on the left
    const infoX = contentX;
    const infoWidth = contentWidth - photoWidth - 30;

    // Name
    ctx.fillStyle = BORDER_COLOR;
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(fullName.toUpperCase(), infoX, contentY + 25);

    // Draw separator under name
    ctx.strokeStyle = ACCENT_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(infoX, contentY + 35);
    ctx.lineTo(infoX + infoWidth, contentY + 35);
    ctx.stroke();

    // Fields with better spacing
    const fieldY = contentY + 60;
    const fieldSpacing = 28;
    const labelX = infoX;
    const valueX = infoX + 100;

    // Adm No
    ctx.fillStyle = FIELD_LABEL_COLOR;
    ctx.font = 'bold 14px Arial';
    ctx.fillText('Adm No:', labelX, fieldY);
    ctx.fillStyle = FIELD_VALUE_COLOR;
    ctx.font = '14px Arial';
    ctx.fillText(student.admission_no, valueX, fieldY);

    // Dept
    ctx.fillStyle = FIELD_LABEL_COLOR;
    ctx.font = 'bold 14px Arial';
    ctx.fillText('Dept:', labelX, fieldY + fieldSpacing);
    ctx.fillStyle = FIELD_VALUE_COLOR;
    ctx.font = '14px Arial';
    ctx.fillText(department.name, valueX, fieldY + fieldSpacing);

    // Course
    ctx.fillStyle = FIELD_LABEL_COLOR;
    ctx.font = 'bold 14px Arial';
    ctx.fillText('Course:', labelX, fieldY + fieldSpacing * 2);
    ctx.fillStyle = FIELD_VALUE_COLOR;
    ctx.font = '14px Arial';
    ctx.fillText(course.name, valueX, fieldY + fieldSpacing * 2);

    // Gender
    ctx.fillStyle = FIELD_LABEL_COLOR;
    ctx.font = 'bold 14px Arial';
    ctx.fillText('Gender:', labelX, fieldY + fieldSpacing * 3);
    ctx.fillStyle = FIELD_VALUE_COLOR;
    ctx.font = '14px Arial';
    ctx.fillText(application.gender, valueX, fieldY + fieldSpacing * 3);

    // ID No
    ctx.fillStyle = FIELD_LABEL_COLOR;
    ctx.font = 'bold 14px Arial';
    ctx.fillText('ID No:', labelX, fieldY + fieldSpacing * 4);
    ctx.fillStyle = FIELD_VALUE_COLOR;
    ctx.font = '14px Arial';
    ctx.fillText(idNumber, valueX, fieldY + fieldSpacing * 4);

    // Expiry
    ctx.fillStyle = FIELD_LABEL_COLOR;
    ctx.font = 'bold 14px Arial';
    ctx.fillText('Expiry:', labelX, fieldY + fieldSpacing * 5);
    ctx.fillStyle = FIELD_VALUE_COLOR;
    ctx.font = '14px Arial';
    ctx.fillText(expiryDate, valueX, fieldY + fieldSpacing * 5);

    // Draw footer section with seal and QR code
    const footerY = CARD_HEIGHT - BORDER_WIDTH - 60;

    // Load and draw seal
    try {
      const seal = await loadImage(SEAL_PATH);
      ctx.drawImage(seal, infoX, footerY, 50, 50);
    } catch (err) {
      console.error('Failed to load seal:', err);
      // Draw placeholder seal
      ctx.fillStyle = ACCENT_COLOR;
      ctx.beginPath();
      ctx.arc(infoX + 25, footerY + 25, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('OFFICIAL', infoX + 25, footerY + 22);
      ctx.fillText('SEAL', infoX + 25, footerY + 32);
    }

    // Draw QR code
    try {
      const qrImage = await loadImage(qrCodeData);
      ctx.drawImage(qrImage, photoX + (photoWidth - 50) / 2, footerY, 50, 50);
    } catch (err) {
      console.error('Failed to load QR code:', err);
    }

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

  const studentIds = students.map(s => s.id);
  return bulkGenerateIDCards(studentIds, outputDir);
}

module.exports = {
  generateIDCard,
  generateAndSaveIDCard,
  bulkGenerateIDCards,
  generateAllActiveIDCards,
};

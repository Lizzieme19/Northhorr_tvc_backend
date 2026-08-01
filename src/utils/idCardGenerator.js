const { createCanvas, loadImage } = require('canvas');
const QRCode = require('qrcode');
const prisma = require('../config/db');

// Asset URLs
const LOGO_URL = process.env.ID_CARD_LOGO_URL || 'https://api.northhorrtvc.ac.ke/public/logo.png';
const SEAL_URL = process.env.ID_CARD_SEAL_URL || 'https://api.northhorrtvc.ac.ke/public/seal.png';
const PLACEHOLDER_PHOTO_URL = process.env.ID_CARD_PLACEHOLDER_PHOTO || 'https://via.placeholder.com/120x140?text=No+Photo';

// Card dimensions
const CARD_WIDTH = 650;
const CARD_HEIGHT = 400;
const BORDER_WIDTH = 6;
const BORDER_COLOR = '#1a7a1a';
const BANNER_WIDTH = 34;

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

    // Draw border
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = BORDER_WIDTH;
    drawRoundedRect(ctx, BORDER_WIDTH/2, BORDER_WIDTH/2, CARD_WIDTH - BORDER_WIDTH, CARD_HEIGHT - BORDER_WIDTH, 18);
    ctx.stroke();

    // Draw side banner
    ctx.fillStyle = BORDER_COLOR;
    ctx.fillRect(BORDER_WIDTH, BORDER_WIDTH, BANNER_WIDTH, CARD_HEIGHT - BORDER_WIDTH * 2);

    // Draw vertical text in banner
    ctx.fillStyle = '#ffffff';
    drawVerticalText(ctx, 'STUDENT IDENTIFICATION CARD', BORDER_WIDTH + BANNER_WIDTH/2, CARD_HEIGHT/2, 20, 'bold');

    // Load and draw logo
    try {
      const logo = await loadImage(LOGO_URL);
      ctx.drawImage(logo, BORDER_WIDTH + BANNER_WIDTH + 14, 14, 55, 55);
    } catch (err) {
      console.error('Failed to load logo:', err);
    }

    // Draw header text
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 11px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('MINISTRY OF EDUCATION STATE DEPARTMENT', BORDER_WIDTH + BANNER_WIDTH + 80, 25);
    ctx.fillText('FOR VOCATIONAL AND TECHNICAL TRAINING', BORDER_WIDTH + BANNER_WIDTH + 80, 40);
    ctx.fillText('NORTH HORR TECHNICAL & VOCATIONAL COLLEGE', BORDER_WIDTH + BANNER_WIDTH + 80, 55);

    // Draw header separator
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(BORDER_WIDTH + BANNER_WIDTH + 14, 68);
    ctx.lineTo(CARD_WIDTH - BORDER_WIDTH - 14, 68);
    ctx.stroke();

    // Load and draw photo
    try {
      const photo = await loadImage(photoUrl);
      ctx.save();
      drawRoundedRect(ctx, BORDER_WIDTH + BANNER_WIDTH + 14, 90, 120, 140, 10);
      ctx.clip();
      ctx.drawImage(photo, BORDER_WIDTH + BANNER_WIDTH + 14, 90, 120, 140);
      ctx.restore();
      ctx.strokeStyle = BORDER_COLOR;
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, BORDER_WIDTH + BANNER_WIDTH + 14, 90, 120, 140, 10);
      ctx.stroke();
    } catch (err) {
      console.error('Failed to load photo:', err);
      // Draw placeholder
      ctx.fillStyle = '#cccccc';
      ctx.fillRect(BORDER_WIDTH + BANNER_WIDTH + 14, 90, 120, 140);
      ctx.fillStyle = '#666666';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('No Photo', BORDER_WIDTH + BANNER_WIDTH + 74, 160);
    }

    // Draw student information
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    
    // Name
    ctx.font = 'bold 17px Arial';
    ctx.fillText(fullName.toUpperCase(), BORDER_WIDTH + BANNER_WIDTH + 154, 100);
    
    // Fields
    ctx.font = '14px Arial';
    const fieldY = 120;
    const fieldSpacing = 18;
    
    ctx.font = 'bold 14px Arial';
    ctx.fillText('Adm No:', BORDER_WIDTH + BANNER_WIDTH + 154, fieldY);
    ctx.font = '14px Arial';
    ctx.fillText(student.admission_no, BORDER_WIDTH + BANNER_WIDTH + 224, fieldY);
    
    ctx.font = 'bold 14px Arial';
    ctx.fillText('Dept:', BORDER_WIDTH + BANNER_WIDTH + 154, fieldY + fieldSpacing);
    ctx.font = '14px Arial';
    ctx.fillText(department.name, BORDER_WIDTH + BANNER_WIDTH + 224, fieldY + fieldSpacing);
    
    ctx.font = 'bold 14px Arial';
    ctx.fillText('Course:', BORDER_WIDTH + BANNER_WIDTH + 154, fieldY + fieldSpacing * 2);
    ctx.font = '14px Arial';
    ctx.fillText(course.name, BORDER_WIDTH + BANNER_WIDTH + 224, fieldY + fieldSpacing * 2);
    
    ctx.font = 'bold 14px Arial';
    ctx.fillText('Gender:', BORDER_WIDTH + BANNER_WIDTH + 154, fieldY + fieldSpacing * 3);
    ctx.font = '14px Arial';
    ctx.fillText(application.gender, BORDER_WIDTH + BANNER_WIDTH + 224, fieldY + fieldSpacing * 3);
    
    ctx.font = 'bold 14px Arial';
    ctx.fillText('ID No:', BORDER_WIDTH + BANNER_WIDTH + 154, fieldY + fieldSpacing * 4);
    ctx.font = '14px Arial';
    ctx.fillText(idNumber, BORDER_WIDTH + BANNER_WIDTH + 224, fieldY + fieldSpacing * 4);
    
    ctx.font = 'bold 14px Arial';
    ctx.fillText('Expiry:', BORDER_WIDTH + BANNER_WIDTH + 154, fieldY + fieldSpacing * 5);
    ctx.font = '14px Arial';
    ctx.fillText(expiryDate, BORDER_WIDTH + BANNER_WIDTH + 224, fieldY + fieldSpacing * 5);

    // Load and draw seal
    try {
      const seal = await loadImage(SEAL_URL);
      ctx.drawImage(seal, BORDER_WIDTH + BANNER_WIDTH + 30, CARD_HEIGHT - BORDER_WIDTH - 50, 40, 40);
    } catch (err) {
      console.error('Failed to load seal:', err);
    }

    // Draw QR code
    try {
      const qrImage = await loadImage(qrCodeData);
      ctx.drawImage(qrImage, CARD_WIDTH - BORDER_WIDTH - 68, CARD_HEIGHT - BORDER_WIDTH - 60, 50, 50);
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

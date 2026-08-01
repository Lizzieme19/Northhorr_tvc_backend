const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const prisma = require('../config/db');

// Asset URLs (these should be configured via environment variables in production)
const LOGO_URL = process.env.ID_CARD_LOGO_URL || 'https://api.northhorrtvc.ac.ke/public/logo.png';
const SEAL_URL = process.env.ID_CARD_SEAL_URL || 'https://api.northhorrtvc.ac.ke/public/seal.png';
const PLACEHOLDER_PHOTO_URL = process.env.ID_CARD_PLACEHOLDER_PHOTO || 'https://via.placeholder.com/120x140?text=No+Photo';

// Template path
const TEMPLATE_PATH = path.join(__dirname, '../../templates/id-card.html');

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
 * Fill template with student data
 */
function fillTemplate(template, studentData, qrCodeData) {
  const { application, course, department } = studentData;
  const fullName = `${application.surname} ${application.other_names}`;
  const photoUrl = studentData.profile_picture_url || PLACEHOLDER_PHOTO_URL;
  const idNumber = application.id_number || 'N/A';
  const expiryDate = studentData.id_card_expiry_date 
    ? formatExpiryDate(studentData.id_card_expiry_date) 
    : 'N/A';

  return template
    .replace('{{LOGO}}', LOGO_URL)
    .replace('{{SEAL}}', SEAL_URL)
    .replace('{{PHOTO}}', photoUrl)
    .replace('{{NAME}}', fullName)
    .replace('{{ADM_NO}}', studentData.admission_no)
    .replace('{{DEPT}}', department.name)
    .replace('{{COURSE}}', course.name)
    .replace('{{GENDER}}', application.gender)
    .replace('{{ID_NO}}', idNumber)
    .replace('{{EXPIRY}}', expiryDate)
    .replace('{{QR_CODE}}', qrCodeData || '');
}

/**
 * Generate ID card as PNG buffer
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

    // Read template
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

    // Fill template
    const html = fillTemplate(template, student, qrCodeData);
    console.log('Template filled');

    // Launch Puppeteer with system Chromium
    console.log('Launching browser...');
    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      protocolTimeout: 120000, // Increase protocol timeout to 2 minutes
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
    });
    console.log('Browser launched');

    const page = await browser.newPage();
    console.log('New page created');

    // Set viewport size to match ID card dimensions
    await page.setViewport({ width: 600, height: 400 });
    console.log('Viewport set');

    // Set content with more lenient timeout and wait conditions
    console.log('Setting page content...');
    await page.setContent(html, { 
      waitUntil: 'domcontentloaded',
      timeout: 60000 
    });
    console.log('Content set');

    // Wait for images to load using a simple delay
    console.log('Waiting for images...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    console.log('Images loaded');

    // Generate screenshot with explicit path to avoid memory issues
    console.log('Taking screenshot...');
    const screenshot = await page.screenshot({
      type: 'png',
      encoding: 'binary',
      clip: { x: 0, y: 0, width: 600, height: 400 }
    });
    console.log('Screenshot taken');

    await browser.close();
    console.log('Browser closed');

    return screenshot;
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

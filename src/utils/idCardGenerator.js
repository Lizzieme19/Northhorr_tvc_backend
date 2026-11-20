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

// ---------------------------------------------------------------------------
// DESIGN. The look of the card (colours, background pattern, watermark, banner text) is set by the admin under
// ID Card Design. These are the defaults.
// ---------------------------------------------------------------------------
const DEFAULT_DESIGN = {
  primary: '#1a7a3d',      // header, banner, frame
  secondary: '#d4a62e',    // gold stripes and photo frame
  label_color: '#7a2d1f',  // field labels
  pattern: 'waves',        // waves | diagonal | dots | chevrons | none
  pattern_strength: 0.16,  // 0.03 (faint) to 0.3 (bold)
  watermark: true,         // the college logo, large and faint behind the details
  banner_text: 'STUDENT IDENTIFICATION CARD',
};
const PATTERNS = ['waves', 'diagonal', 'dots', 'chevrons', 'none'];

const cleanDesign = (v = {}) => {
  const out = {};
  for (const k of ['primary', 'secondary', 'label_color']) if (typeof v[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(v[k])) out[k] = v[k];
  if (PATTERNS.includes(v.pattern)) out.pattern = v.pattern;
  const st = parseFloat(v.pattern_strength);
  if (!isNaN(st)) out.pattern_strength = Math.min(0.3, Math.max(0.03, st));
  if (typeof v.watermark === 'boolean') out.watermark = v.watermark;
  if (typeof v.banner_text === 'string' && v.banner_text.trim()) out.banner_text = v.banner_text.trim().slice(0, 40).toUpperCase();
  return out;
};

async function loadDesign(override) {
  if (override) return { ...DEFAULT_DESIGN, ...cleanDesign(override) };
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: 'id_card_design' } });
    if (row) return { ...DEFAULT_DESIGN, ...cleanDesign(JSON.parse(row.value)) };
  } catch (e) { /* use the defaults */ }
  return { ...DEFAULT_DESIGN };
}

// '#1a7a3d' mixed with white (amount 0..1 toward white) or black (negative)
function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amount < 0 ? 0 : 255, k = Math.abs(amount);
  r = Math.round(r + (t - r) * k); g = Math.round(g + (t - g) * k); b = Math.round(b + (t - b) * k);
  return `rgb(${r},${g},${b})`;
}
function withAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// The repeating pattern drawn over the card background, in the primary colour
function drawPattern(ctx, design, w, h) {
  if (design.pattern === 'none') return;
  ctx.save();
  ctx.strokeStyle = withAlpha(design.primary, design.pattern_strength);
  ctx.fillStyle = withAlpha(design.primary, design.pattern_strength);
  ctx.lineWidth = 1.4;
  if (design.pattern === 'waves') {
    for (let y = -10; y < h + 20; y += 16) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 6) {
        const yy = y + Math.sin((x / w) * Math.PI * 6 + y * 0.15) * 6;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  } else if (design.pattern === 'diagonal') {
    for (let x = -h; x < w + h; x += 14) { ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x + h, 0); ctx.stroke(); }
  } else if (design.pattern === 'dots') {
    for (let y = 8; y < h; y += 14) for (let x = (Math.round(y / 14) % 2) * 7 + 6; x < w; x += 14) { ctx.beginPath(); ctx.arc(x, y, 1.7, 0, Math.PI * 2); ctx.fill(); }
  } else if (design.pattern === 'chevrons') {
    for (let y = 0; y < h + 16; y += 16) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 16) { const yy = y + ((x / 16) % 2 ? 7 : 0); if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
      ctx.stroke();
    }
  }
  ctx.restore();
}

// A plain figure for the preview, where there is no real photo
function drawSilhouette(ctx, x, y, w, h) {
  ctx.fillStyle = '#e8eee9';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#b7c4ba';
  ctx.beginPath(); ctx.arc(x + w / 2, y + h * 0.36, w * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + w / 2, y + h * 0.88, w * 0.36, h * 0.28, 0, Math.PI, 0); ctx.fill();
}

/**
 * Draw one card. `data` holds what is printed; nothing here touches the database.
 */
async function renderCard(data, design) {
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');
  const P = design.primary;
  const G = design.secondary;

  // ---- Background: soft tint, pattern, watermark (all kept inside the rounded card) ----
  ctx.save();
  drawRoundedRect(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, 18);
  ctx.clip();
  const bg = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  bg.addColorStop(0, '#ffffff');
  bg.addColorStop(1, shade(P, 0.9));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  drawPattern(ctx, design, CARD_WIDTH, CARD_HEIGHT);

  const schoolImg = await safeLoadImage(LOGO_PATH, 'School logo');
  const ministryImg = await safeLoadImage(MINISTRY_PATH, 'Ministry logo');
  if (design.watermark && schoolImg) {
    ctx.globalAlpha = 0.07;
    ctx.drawImage(schoolImg, CARD_WIDTH - 330, HEADER_BOTTOM + 8, 290, 290);
    ctx.globalAlpha = 1;
  }

  // ---- Header band ----
  const hb = ctx.createLinearGradient(0, 0, CARD_WIDTH, 0);
  hb.addColorStop(0, shade(P, -0.28));
  hb.addColorStop(0.5, P);
  hb.addColorStop(1, shade(P, -0.28));
  ctx.fillStyle = hb;
  ctx.fillRect(0, 0, CARD_WIDTH, HEADER_BOTTOM + 8);
  ctx.fillStyle = G;
  ctx.fillRect(0, HEADER_BOTTOM + 8, CARD_WIDTH, 4);
  ctx.restore();

  // ---- Frame: outer colour, inner gold hairline ----
  ctx.strokeStyle = P;
  ctx.lineWidth = BORDER_WIDTH;
  drawRoundedRect(ctx, BORDER_WIDTH / 2, BORDER_WIDTH / 2, CARD_WIDTH - BORDER_WIDTH, CARD_HEIGHT - BORDER_WIDTH, 18);
  ctx.stroke();
  ctx.strokeStyle = withAlpha(G, 0.85);
  ctx.lineWidth = 1;
  drawRoundedRect(ctx, 9, 9, CARD_WIDTH - 18, CARD_HEIGHT - 18, 14);
  ctx.stroke();

  // ---- Logos on white badges ----
  const badge = (x, img, label) => {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(x + LOGO_SIZE / 2, LOGO_Y + LOGO_SIZE / 2 + 2, LOGO_SIZE / 2 + 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = G; ctx.lineWidth = 2; ctx.stroke();
    if (img) ctx.drawImage(img, x + 3, LOGO_Y + 5, LOGO_SIZE - 6, LOGO_SIZE - 6);
    else drawBadgePlaceholder(ctx, x, LOGO_Y + 2, LOGO_SIZE, label);
  };
  const ministryX = CONTENT_LEFT;
  const schoolX = CONTENT_RIGHT - LOGO_SIZE;
  badge(ministryX, ministryImg, 'MOE');
  badge(schoolX, schoolImg, 'NHTVC');

  const textLeft = ministryX + LOGO_SIZE + 12;
  const textRight = schoolX - 12;
  const headerCenterX = (textLeft + textRight) / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 11.5px Arial';
  ctx.fillText('MINISTRY OF EDUCATION STATE DEPARTMENT', headerCenterX, CONTENT_TOP + 20);
  ctx.fillText('FOR VOCATIONAL AND TECHNICAL TRAINING', headerCenterX, CONTENT_TOP + 35);
  ctx.font = 'bold 15px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('NORTH HORR TECHNICAL & VOCATIONAL COLLEGE', headerCenterX, CONTENT_TOP + 55);

  // ---- Name ----
  const nameY = HEADER_BOTTOM + 36;
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 21px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(data.fullName.toUpperCase(), CONTENT_LEFT, nameY);
  ctx.fillStyle = G;
  ctx.fillRect(CONTENT_LEFT, nameY + 6, 56, 3);

  // ---- Photo with gold frame and a soft shadow ----
  const px = PHOTO_X, py = PHOTO_Y + 20, pw = PHOTO_W, ph = PHOTO_H - 14;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#ffffff';
  drawRoundedRect(ctx, px, py, pw, ph, 10);
  ctx.fill();
  ctx.restore();
  let drewPhoto = false;
  if (data.photoUrl) {
    try {
      const photo = await loadImage(data.photoUrl);
      ctx.save();
      drawRoundedRect(ctx, px, py, pw, ph, 10);
      ctx.clip();
      ctx.drawImage(photo, px, py, pw, ph);
      ctx.restore();
      drewPhoto = true;
    } catch (err) {
      console.error('Failed to load photo:', err.message);
    }
  }
  if (!drewPhoto) {
    ctx.save();
    drawRoundedRect(ctx, px, py, pw, ph, 10);
    ctx.clip();
    drawSilhouette(ctx, px, py, pw, ph);
    ctx.restore();
  }
  ctx.strokeStyle = G;
  ctx.lineWidth = 3.5;
  drawRoundedRect(ctx, px, py, pw, ph, 10);
  ctx.stroke();

  // ---- Fields ----
  const fieldY = PHOTO_Y + 44;
  const fieldSpacing = 21;
  const labelX = INFO_X;
  const valueX = INFO_X + 78;
  data.fields.forEach(([label, value], i) => {
    const y = fieldY + i * fieldSpacing;
    ctx.fillStyle = design.label_color;
    ctx.font = 'bold 15px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(label, labelX, y);
    ctx.fillStyle = FIELD_VALUE_COLOR;
    ctx.font = '15px Arial';
    ctx.fillText(String(value), valueX, y);
  });

  // ---- QR code on a white tile ----
  if (data.qrCodeData) {
    try {
      const qrImage = await loadImage(data.qrCodeData);
      const qrX = CONTENT_RIGHT - 52 - 8;
      const qrY = PHOTO_Y + PHOTO_H - 52 - 4;
      ctx.fillStyle = '#ffffff';
      drawRoundedRect(ctx, qrX - 5, qrY - 5, 62, 62, 6);
      ctx.fill();
      ctx.strokeStyle = withAlpha(P, 0.5); ctx.lineWidth = 1; ctx.stroke();
      ctx.drawImage(qrImage, qrX, qrY, 52, 52);
    } catch (err) {
      console.error('Failed to load QR code:', err);
    }
  }

  // ---- Bottom banner ----
  ctx.save();
  drawRoundedRect(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, 18);
  ctx.clip();
  const bb = ctx.createLinearGradient(0, 0, CARD_WIDTH, 0);
  bb.addColorStop(0, shade(P, -0.28)); bb.addColorStop(0.5, P); bb.addColorStop(1, shade(P, -0.28));
  ctx.fillStyle = bb;
  ctx.fillRect(0, BANNER_Y, CARD_WIDTH, BANNER_HEIGHT);
  ctx.fillStyle = G;
  ctx.fillRect(0, BANNER_Y, CARD_WIDTH, 3);
  ctx.restore();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 17px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(design.banner_text, CARD_WIDTH / 2, BANNER_Y + 24);

  return canvas.toBuffer('image/png');
}

/**
 * Generate ID card as PNG buffer using Canvas
 */
async function generateIDCard(studentId) {
  try {
    const student = await getStudentData(studentId);
    const design = await loadDesign();
    const qrCodeData = await generateQRCode(student.admission_no);

    const { application, course, department } = student;
    return await renderCard({
      fullName: `${application.surname} ${application.other_names}`,
      photoUrl: student.profile_picture_url || PLACEHOLDER_PHOTO_URL,
      qrCodeData,
      fields: [
        ['Adm No:', student.admission_no],
        ['Dept:', department.name],
        ['Course:', course.name],
        ['Gender:', application.gender],
        ['ID No:', application.id_number || 'N/A'],
        ['Expiry:', student.id_card_expiry_date ? formatExpiryDate(student.id_card_expiry_date) : 'N/A'],
      ],
    }, design);
  } catch (error) {
    console.error('ID card generation error:', error);
    throw error;
  }
}

/**
 * A sample card for the design screen: example details, no real student, no database lookups for the student
 */
async function generateSampleIDCard(designOverride) {
  const design = await loadDesign(designOverride);
  const qrCodeData = await generateQRCode('SAMPLE/001/2026S');
  return renderCard({
    fullName: 'Sample Student Name',
    photoUrl: null,
    qrCodeData,
    fields: [['Adm No:', 'SAMPLE/001/2026S'], ['Dept:', 'Computing & Informatics'], ['Course:', 'ICT Technician'], ['Gender:', 'Female'], ['ID No:', '12345678'], ['Expiry:', 'Dec 2027']],
  }, design);
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
  DEFAULT_DESIGN,
  cleanDesign,
  loadDesign,
  generateSampleIDCard,
  generateIDCard,
  generateAndSaveIDCard,
  bulkGenerateIDCards,
  generateAllActiveIDCards,
};

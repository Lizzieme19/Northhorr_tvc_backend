/**
 * Northhorr TVC — Student Excel Import Script
 * ============================================
 * Usage:
 *   node scripts/import_students_excel.js            # Live run
 *   DRY_RUN=true node scripts/import_students_excel.js  # Dry run (no DB writes)
 *   node scripts/import_students_excel.js --sheet=CONTINUING  # Single sheet
 *
 * Reads: (project root)/ALL STUDENTS DATA.xlsx
 * Upserts students by admission_no (update if exists, insert if new)
 *
 * EMAIL STRATEGY (when Excel has no email column):
 *   1. Use email from Excel if present and looks valid
 *   2. Derive from phone:  0794330883 → s0794330883@ntvc.ac.ke
 *   3. Derive from ADM NO: CEE/002/2024M → cee0022024m@ntvc.ac.ke  ← DEFAULT
 *   4. Derive from name+adm snippet as last resort
 *   Collisions get a timestamp suffix so nothing is ever blocked.
 *
 * DATA SAFETY NOTE:
 *   The ATTACHMENT enum migration uses ALTER TYPE ... ADD VALUE IF NOT EXISTS.
 *   This is a PostgreSQL non-destructive DDL — it never touches existing rows.
 */

require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const SINGLE_SHEET = (() => {
  const flag = process.argv.find(a => a.startsWith('--sheet='));
  return flag ? flag.split('=')[1] : null;
})();

const EXCEL_PATH = path.join(__dirname, '..', '..', 'ALL STUDENTS DATA.xlsx');
const DEFAULT_PASSWORD = 'Northhorr@2026';

// ===========================================================================
// NORMALIZERS
// ===========================================================================

function normalizeStatus(raw) {
  if (!raw) return 'ACTIVE';
  const s = String(raw).trim().toLowerCase();
  if (s.includes('continu')) return 'ACTIVE';        // continuing / contuinuing
  if (s.includes('attach'))  return 'ATTACHMENT';
  if (s.includes('complet')) return 'GRADUATED';
  if (s.includes('desert'))  return 'WITHDRAWN';
  if (s.includes('deceased')) return 'WITHDRAWN';
  if (s.includes('withdraw')) return 'WITHDRAWN';
  if (s.includes('defer'))   return 'DEFERRED';
  return 'ACTIVE'; // default
}

function normalizeLevel(raw) {
  if (!raw) return 'Level 5';
  const s = String(raw).trim().replace(/[^0-9]/g, '');
  const num = parseInt(s);
  if ([3, 4, 5, 6].includes(num)) return `Level ${num}`;
  return 'Level 5'; // default
}

function parseAdmissionPeriod(raw) {
  if (!raw) return { intake: 'SEPTEMBER', year: new Date().getFullYear() };
  const s = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');

  let year = null;
  const yearMatch = s.match(/\d{4}/);
  if (yearMatch) year = parseInt(yearMatch[0]);
  else year = new Date().getFullYear();

  let intake = 'SEPTEMBER';
  if (s.match(/jan/i)) intake = 'JANUARY';
  else if (s.match(/may|m$/i)) intake = 'MAY';
  else if (s.match(/sep|s$/i)) intake = 'SEPTEMBER';

  return { intake, year };
}

function splitName(fullName) {
  if (!fullName) return { surname: 'Unknown', other_names: '' };
  const trimmed = String(fullName).trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { surname: parts[0], other_names: '' };
  const surname = parts[0];
  const other_names = parts.slice(1).join(' ');
  return { surname, other_names };
}

function normalizeGender(raw) {
  if (!raw) return 'Other';
  const s = String(raw).trim().toUpperCase();
  if (s === 'M' || s === 'MALE') return 'Male';
  if (s === 'F' || s === 'FEMALE') return 'Female';
  return 'Other';
}

/**
 * generateEmail — multi-strategy email builder
 *
 * Strategy priority:
 *  1. If Excel contains a valid-looking email → use it directly
 *  2. If student has a phone number  → s<phone>@ntvc.ac.ke
 *  3. Derive from ADM NO (always available at this point)
 *     → strip non-alphanumeric, lowercase, append @ntvc.ac.ke
 *  4. Name + first 6 chars of ADM NO (last-resort fallback)
 *
 * Returns { email, emailSource } so the log can show which strategy fired.
 */
function generateEmail({ emailRaw, phone, admNo, surname, other_names }) {
  const DOMAIN = 'ntvc.ac.ke';

  // Strategy 1 — Excel-provided email
  if (emailRaw) {
    const trimmed = String(emailRaw).trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return { email: trimmed, emailSource: 'excel' };
    }
  }

  // Strategy 2 — Phone-based
  if (phone && /^\d{9,12}$/.test(String(phone).replace(/[^0-9]/g, ''))) {
    const cleaned = String(phone).replace(/[^0-9]/g, '');
    return { email: `s${cleaned}@${DOMAIN}`, emailSource: 'phone' };
  }

  // Strategy 3 — ADM NO based (primary fallback)
  if (admNo) {
    const clean = String(admNo).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (clean.length >= 4) {
      return { email: `${clean}@${DOMAIN}`, emailSource: 'adm_no' };
    }
  }

  // Strategy 4 — Name + ADM snippet
  const namePart = String(surname || 'student').replace(/[^a-zA-Z]/g, '').toLowerCase().slice(0, 8);
  const admPart  = String(admNo  || 'x').replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 6);
  return { email: `${namePart}.${admPart}@${DOMAIN}`, emailSource: 'name_adm' };
}

/**
 * resolveUniqueEmail — checks DB for collision and appends timestamp suffix if needed.
 * Never blocks; always returns a usable email.
 */
async function resolveUniqueEmail(baseEmail, prismaClient) {
  const exists = await prismaClient.user.findUnique({ where: { email: baseEmail } });
  if (!exists) return baseEmail;
  // Collision: insert a short timestamp before the @
  const [local, domain] = baseEmail.split('@');
  return `${local}.${Date.now()}@${domain}`;
}

function generateAppNo() {
  const year = new Date().getFullYear();
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `NTVC/APP/${year}/${rand}`;
}

// ===========================================================================
// COURSE ALIAS MAP
// Keys (lowercase) -> Course shortcode in DB
// ===========================================================================
const COURSE_ALIASES = {
  // Electrical
  'electrical': 'CEE',
  'electrical engineering': 'CEE',
  'electrical eng': 'CEE',
  'electrical installation': 'CEE',
  // Agriculture
  'agriculture': 'CGA',
  'general agriculture': 'CGA',
  'animal production': 'CGA',
  // ICT
  'ict': 'ICT',
  'information communication technology': 'ICT',
  'information technology': 'ICT',
  'computer': 'ICT',
  // Social Work
  'social work': 'DSW',
  'community development': 'DSW',
  // Fashion
  'fashion & design': 'CFD',
  'fashion and design': 'CFD',
  'fahion & design': 'CFD',
  'fashion design': 'CFD',
  // Hair Dressing
  'hair dressing': 'CHD',
  'hairdressing': 'CHD',
  // Human Resource
  'human resource': 'CHR',
  'human resource management': 'CHR',
  // Supply Chain / Procurement
  'supply chain': 'CSC',
  'supply chain management': 'CSC',
  'procurement': 'CSC',
  // Food Science
  'food science': 'CFS',
  'food processing': 'CFS',
  // Building / Civil
  'civil engineering': 'CCE',
  'building technology': 'CCE',
  'build technology': 'CCE',
  'building tech': 'CCE',
  'building': 'CCE',
  'plumbing': 'CPL',
  // Business Management
  'business management': 'CBM',
  'bussiness management': 'CBM',
};

// ===========================================================================
// MAIN
// ===========================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('Northhorr TVC - Student Excel Import');
  console.log(DRY_RUN ? 'WARNING: DRY RUN MODE - No DB writes' : 'LIVE RUN - Writing to DB');
  console.log('='.repeat(70));

  // Load all courses from DB
  const dbCourses = await prisma.course.findMany({ include: { department: true } });
  console.log(`Found ${dbCourses.length} courses in DB:`, dbCourses.map(c => `${c.shortcode}(${c.name})`).join(', '));

  function matchCourse(courseStr) {
    if (!courseStr) return null;
    const s = String(courseStr).trim().toLowerCase();

    // Try alias map first
    const alias = COURSE_ALIASES[s];
    if (alias) {
      const found = dbCourses.find(c => c.shortcode.toUpperCase() === alias.toUpperCase());
      if (found) return found;
    }

    // Direct shortcode match
    const direct = dbCourses.find(c => c.shortcode.toLowerCase() === s);
    if (direct) return direct;

    // Partial name match
    const partial = dbCourses.find(c => c.name.toLowerCase().includes(s) || s.includes(c.name.toLowerCase()));
    if (partial) return partial;

    // Fuzzy: check if any alias key is substring of input
    for (const [key, shortcode] of Object.entries(COURSE_ALIASES)) {
      if (s.includes(key) || key.includes(s)) {
        const found = dbCourses.find(c => c.shortcode.toUpperCase() === shortcode);
        if (found) return found;
      }
    }

    return null;
  }

  // Load workbook
  console.log(`\nLoading Excel: ${EXCEL_PATH}`);
  const wb = XLSX.readFile(EXCEL_PATH);

  // Sheet processing order: ALL first (has gender), then others
  const SHEET_ORDER = SINGLE_SHEET
    ? [SINGLE_SHEET]
    : ['ALL', 'CONTINUING', 'COMPLETED', 'DESERTED', 'ATTACHMENT', 'DECEASED'];

  const totalStats = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  // Track processed admission numbers across sheets (to avoid duplicate inserts)
  const processedAdmNos = new Set();

  for (const sheetName of SHEET_ORDER) {
    if (!wb.SheetNames.includes(sheetName)) {
      console.log(`\nWARN: Sheet "${sheetName}" not found - skipping`);
      continue;
    }

    console.log(`\n${'-'.repeat(70)}`);
    console.log(`Processing sheet: ${sheetName}`);

    const ws = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

    if (rawRows.length < 2) {
      console.log(`  Empty sheet - skipping`);
      continue;
    }

    const headerRow = rawRows[0];
    console.log(`  Headers: ${JSON.stringify(headerRow)}`);

    // Detect column indices dynamically
    const findCol = (keywords) => {
      const idx = headerRow.findIndex(h => h && keywords.some(k => String(h).toLowerCase().includes(k.toLowerCase())));
      return idx >= 0 ? idx : null;
    };

    const COL = {
      sno:    findCol(['S/NO', 'S NO']),
      names:  findCol(['NAMES', 'NAME']),
      kcpe:   findCol(['KCPE']),
      kcse:   findCol(['KCSE']),
      course: findCol(['COURSE']),
      adm_no: findCol(['ADM NO', 'ADM.NO', 'REG NO', 'REGISTRATION']),
      gender: findCol(['GENDER']),
      phone:  findCol(['PHONE']),
      email:  findCol(['EMAIL', 'E-MAIL', 'EMAIL ADDRESS']), // rarely present; null if absent
      level:  findCol(['LEVEL']),
      period: findCol(['ADMISSION PERIOD', 'PERIOD']),
      status: findCol(['STATUS']),
    };

    let sheetInserted = 0, sheetUpdated = 0, sheetSkipped = 0;

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row || !row.length) continue;

      const sno = COL.sno !== null ? row[COL.sno] : null;
      // Skip non-data rows (department headers, empty rows)
      if (sno === null || sno === undefined || typeof sno === 'string') continue;

      const admNo = COL.adm_no !== null ? row[COL.adm_no] : null;
      if (!admNo || String(admNo).trim().length < 4) {
        totalStats.errors.push({ sheet: sheetName, row: i + 1, names: row[COL.names], error: 'Missing or invalid ADM NO' });
        sheetSkipped++;
        continue;
      }

      const admNoClean = String(admNo).trim();
      const courseStr  = COL.course !== null ? row[COL.course] : null;
      const namesRaw   = COL.names  !== null ? row[COL.names]  : null;
      const genderRaw  = COL.gender !== null ? row[COL.gender] : null;
      const phoneRaw   = COL.phone  !== null ? row[COL.phone]  : null;
      const emailRaw   = COL.email  !== null ? row[COL.email]  : null; // rarely present
      const levelRaw   = COL.level  !== null ? row[COL.level]  : null;
      const periodRaw  = COL.period !== null ? row[COL.period] : null;
      const statusRaw  = COL.status !== null ? row[COL.status] : null;
      const kcseRaw    = COL.kcse   !== null ? row[COL.kcse]   : null;
      const kcpeRaw    = COL.kcpe   !== null ? row[COL.kcpe]   : null;

      const { surname, other_names } = splitName(namesRaw);
      const gender      = normalizeGender(genderRaw);
      const phone       = phoneRaw ? String(phoneRaw).replace(/[^0-9+]/g, '').trim() : null;
      const level       = normalizeLevel(levelRaw);
      const { intake, year } = parseAdmissionPeriod(periodRaw);
      const status      = normalizeStatus(statusRaw);
      const courseMatch = matchCourse(courseStr);
      const kcse_index  = kcseRaw ? String(kcseRaw).trim() : null;
      const kcpe_index  = kcpeRaw ? String(kcpeRaw).trim() : null;
      const { email: baseEmail, emailSource } = generateEmail({
        emailRaw, phone, admNo: admNoClean, surname, other_names,
      });

      if (!courseMatch) {
        totalStats.errors.push({
          sheet: sheetName, row: i + 1,
          adm_no: admNoClean, names: namesRaw,
          error: `Course not matched: "${courseStr}"`,
        });
        sheetSkipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  [DRY] Row ${i + 1}: ${admNoClean} | ${namesRaw} | ${courseMatch.shortcode} | ${level} | ${intake} ${year} | ${status} | email-via:${emailSource}(${baseEmail})`);
        processedAdmNos.add(admNoClean);
        sheetInserted++;
        continue;
      }

      try {
        // Check if student already exists
        const existing = await prisma.student.findUnique({
          where: { admission_no: admNoClean },
          include: { application: true },
        });

        if (existing) {
          // UPDATE existing student
          const studentUpdate = {};
          if (existing.status !== status) studentUpdate.status = status;
          if (existing.level !== level)   studentUpdate.level  = level;
          if (existing.intake !== intake) studentUpdate.intake = intake;
          if (existing.year   !== year)   studentUpdate.year   = year;

          const appUpdate = {};
          if (!existing.application?.kcse_index && kcse_index) appUpdate.kcse_index = kcse_index;
          if (!existing.application?.kcpe_index && kcpe_index) appUpdate.kcpe_index = kcpe_index;
          if ((!existing.application?.phone || existing.application.phone === '0000000000') && phone)
            appUpdate.phone = phone;
          if ((!existing.application?.gender || existing.application.gender === 'Other') && genderRaw)
            appUpdate.gender = gender;

          if (Object.keys(studentUpdate).length > 0) {
            await prisma.student.update({ where: { admission_no: admNoClean }, data: studentUpdate });
          }
          if (Object.keys(appUpdate).length > 0 && existing.application) {
            await prisma.application.update({ where: { id: existing.application.id }, data: appUpdate });
          }

          console.log(`  UPDATED: ${admNoClean} - ${Object.keys(studentUpdate).join(', ') || 'no student changes'}`);
          sheetUpdated++;
          totalStats.updated++;

        } else if (!processedAdmNos.has(admNoClean)) {
          // ── INSERT new student ───────────────────────────────────────────────
          // Resolve email with collision check
          const finalEmail = await resolveUniqueEmail(baseEmail, prisma);
          const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 12);

          await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
              data: {
                email: finalEmail,
                password: hashedPassword,
                role: 'STUDENT',
                must_change_password: true,
                is_active: true,
              },
            });

            const application = await tx.application.create({
              data: {
                application_no: generateAppNo(),
                type: 'DIRECT',
                surname,
                other_names,
                gender,
                date_of_birth: new Date('2000-01-01'), // DOB not in Excel — placeholder
                email: finalEmail,
                // Phone: use real value if present, otherwise placeholder
                // Students can update this themselves after first login
                phone: (phone && phone.length >= 9) ? phone : '0000000000',
                kcse_index,
                kcpe_index,
                course_id: courseMatch.id,
                department_id: courseMatch.department_id,
                level_applied: level,
                status: 'APPROVED',
              },
            });

            await tx.student.create({
              data: {
                admission_no: admNoClean,
                user_id: user.id,
                application_id: application.id,
                course_id: courseMatch.id,
                department_id: courseMatch.department_id,
                level,
                intake,
                year,
                status,
              },
            });
          });

          console.log(`  INSERTED: ${admNoClean} - ${namesRaw} (${courseMatch.shortcode}, ${status}) [email:${emailSource}]`);
          processedAdmNos.add(admNoClean);
          sheetInserted++;
          totalStats.inserted++;
        } else {
          // Already processed in a previous sheet - only update
          console.log(`  SKIP (already processed): ${admNoClean}`);
          sheetSkipped++;
          totalStats.skipped++;
        }

      } catch (err) {
        console.error(`  ERROR row ${i + 1} (${admNoClean}): ${err.message}`);
        totalStats.errors.push({ sheet: sheetName, row: i + 1, adm_no: admNoClean, names: namesRaw, error: err.message });
        sheetSkipped++;
      }
    }

    console.log(`\n  Sheet "${sheetName}" done: +${sheetInserted} inserted, ~${sheetUpdated} updated, ${sheetSkipped} skipped`);
  }

  // SUMMARY
  console.log('\n' + '='.repeat(70));
  console.log('IMPORT COMPLETE');
  console.log('='.repeat(70));
  console.log(`Inserted : ${totalStats.inserted}`);
  console.log(`Updated  : ${totalStats.updated}`);
  console.log(`Skipped  : ${totalStats.skipped}`);
  console.log(`Errors   : ${totalStats.errors.length}`);

  if (totalStats.errors.length > 0) {
    console.log('\nError Details:');
    totalStats.errors.forEach((e, idx) => {
      console.log(`  ${idx + 1}. [${e.sheet}] Row ${e.row} | ADM: ${e.adm_no || '-'} | ${e.names || '-'} -> ${e.error}`);
    });
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});

/**
 * Northhorr TVC — Student Excel Import Script
 * ============================================
 * Usage:
 *   node scripts/import_students_excel.js            # Live run
 *   DRY_RUN=true node scripts/import_students_excel.js  # Dry run (no DB writes)
 *   node scripts/import_students_excel.js --sheet=CONTINUING  # Single sheet
 *
 * Reads: ALL STUDENTS DATA.xlsx (same directory as this backend)
 *
 * RULES (per user spec):
 *  - Admission numbers kept exactly as they appear in Excel (no changes)
 *  - Email filler: {adm_no_cleaned}@ntvc.ac.ke  e.g. cee0022024m@ntvc.ac.ke
 *  - Temp password: Northhorr@2026  (must_change_password = true)
 *  - Cycle column (1/2/3/KNEC) → matched to a Term in DB → current_term_id set
 *  - Student, admin, or dept_head can update profile/email after first login
 */

require('dotenv').config();
const XLSX  = require('xlsx');
const path  = require('path');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma    = new PrismaClient();
const DRY_RUN   = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
const SINGLE_SHEET = (() => {
  const f = process.argv.find(a => a.startsWith('--sheet='));
  return f ? f.split('=')[1] : null;
})();

const EXCEL_PATH      = path.join(__dirname, '..', 'ALL STUDENTS DATA.xlsx');
const DEFAULT_PASSWORD = 'Northhorr@2026';
const EMAIL_DOMAIN    = 'northhorrtvc.ac.ke';

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Keep admission number exactly as in Excel — just trim whitespace */
function cleanAdmNo(raw) {
  return String(raw).trim();
}

/** Filler email derived from the admission number — always predictable */
function fillerEmail(admNo) {
  const clean = String(admNo).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return `${clean}@${EMAIL_DOMAIN}`;
}

/** Handle duplicate filler email with a numeric suffix */
async function uniqueEmail(base) {
  const exists = await prisma.user.findUnique({ where: { email: base } });
  if (!exists) return base;
  const [local, domain] = base.split('@');
  return `${local}.${Date.now()}@${domain}`;
}

function normalizeStatus(raw) {
  if (!raw) return 'ACTIVE';
  const s = String(raw).trim().toLowerCase();
  if (s.includes('continu')) return 'ACTIVE';
  if (s.includes('attach'))  return 'ATTACHMENT';
  if (s.includes('complet')) return 'GRADUATED';
  if (s.includes('desert'))  return 'WITHDRAWN';
  if (s.includes('deceased')) return 'WITHDRAWN';
  if (s.includes('withdraw')) return 'WITHDRAWN';
  if (s.includes('defer'))   return 'DEFERRED';
  return 'ACTIVE';
}

function normalizeLevel(raw) {
  if (!raw) return 'Level 5';
  const num = parseInt(String(raw).replace(/[^0-9]/g, ''));
  return [3, 4, 5, 6].includes(num) ? `Level ${num}` : 'Level 5';
}

function parseAdmissionPeriod(raw) {
  if (!raw) return { intake: 'SEPTEMBER', year: new Date().getFullYear() };
  const s = String(raw).trim().toLowerCase();
  const yearMatch = s.match(/\d{4}/);
  const year = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();
  let intake = 'SEPTEMBER';
  if (s.match(/jan/i))        intake = 'JANUARY';
  else if (s.match(/may|m$/)) intake = 'MAY';
  else if (s.match(/sep|s$/)) intake = 'SEPTEMBER';
  return { intake, year };
}

function splitName(fullName) {
  const trimmed = String(fullName || '').trim();
  if (!trimmed) return { surname: 'Unknown', other_names: '' };
  const parts = trimmed.split(/\s+/);
  return parts.length === 1
    ? { surname: parts[0], other_names: '' }
    : { surname: parts[0], other_names: parts.slice(1).join(' ') };
}

function normalizeGender(raw) {
  if (!raw) return 'Other';
  const s = String(raw).trim().toUpperCase();
  if (s === 'M' || s === 'MALE')   return 'Male';
  if (s === 'F' || s === 'FEMALE') return 'Female';
  return 'Other';
}

function generateAppNo() {
  const year = new Date().getFullYear();
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `NTVC/APP/${year}/${rand}`;
}

/**
 * parseCycle — maps the Excel "Cycle (1,2,3) or KNEC" column to a term number.
 * Returns integer 1, 2, or 3.  KNEC / null defaults to 3 (final module).
 */
function parseCycle(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (s.includes('knec')) return 3;           // KNEC exam = final module
  const num = parseInt(s);
  if ([1, 2, 3].includes(num)) return num;
  return null;
}

// ---------------------------------------------------------------------------
// COURSE ALIASES  (lowercase Excel string → DB shortcode)
// ---------------------------------------------------------------------------
const COURSE_ALIASES = {
  // Electrical
  'electrical': 'CEE', 'electrical engineering': 'CEE',
  'electrical eng': 'CEE', 'electrical installation': 'CEE',
  // Agriculture
  'agriculture': 'CGA', 'general agriculture': 'CGA', 'animal production': 'CGA',
  // ICT
  'ict': 'ICT', 'information communication technology': 'ICT',
  'information technology': 'ICT', 'computer': 'ICT',
  // Social Work
  'social work': 'DSW', 'community development': 'DSW',
  // Fashion
  'fashion & design': 'CFD', 'fashion and design': 'CFD',
  'fahion & design': 'CFD', 'fashion design': 'CFD',
  // Hair Dressing
  'hair dressing': 'CHD', 'hairdressing': 'CHD',
  // Human Resource
  'human resource': 'CHR', 'human resource management': 'CHR',
  // Supply Chain / Procurement
  'supply chain': 'CSC', 'supply chain management': 'CSC', 'procurement': 'CSC',
  // Food Science
  'food science': 'CFS', 'food processing': 'CFS',
  // Building / Civil
  'civil engineering': 'CCE', 'building technology': 'CCE',
  'build technology': 'CCE', 'building tech': 'CCE', 'building': 'CCE',
  'plumbing': 'CPL',
  // Business Management
  'business management': 'CBM', 'bussiness management': 'CBM',
};

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  console.log('='.repeat(70));
  console.log('Northhorr TVC — Student Excel Import');
  console.log(DRY_RUN ? '⚠  DRY RUN — No DB writes' : '🟢 LIVE RUN — Writing to DB');
  console.log('='.repeat(70));

  // ── Load DB courses ──────────────────────────────────────────────────────
  const dbCourses = await prisma.course.findMany({ include: { department: true } });
  console.log(`\nCourses in DB (${dbCourses.length}):`,
    dbCourses.map(c => `${c.shortcode}=${c.name}`).join(' | '));

  function matchCourse(raw) {
    if (!raw) return null;
    const s = String(raw).trim().toLowerCase();
    // Alias map
    const sc = COURSE_ALIASES[s];
    if (sc) { const f = dbCourses.find(c => c.shortcode.toLowerCase() === sc.toLowerCase()); if (f) return f; }
    // Direct shortcode
    const d = dbCourses.find(c => c.shortcode.toLowerCase() === s);
    if (d) return d;
    // Partial name
    const p = dbCourses.find(c => c.name.toLowerCase().includes(s) || s.includes(c.name.toLowerCase()));
    if (p) return p;
    // Fuzzy via alias keys
    for (const [key, shortcode] of Object.entries(COURSE_ALIASES)) {
      if (s.includes(key) || key.includes(s)) {
        const f = dbCourses.find(c => c.shortcode.toLowerCase() === shortcode.toLowerCase());
        if (f) return f;
      }
    }
    return null;
  }

  // ── Load DB Terms (for cycle→term mapping) ───────────────────────────────
  // Terms are ordered by start_date so term_number[0]=oldest, etc.
  const dbTerms = await prisma.term.findMany({ orderBy: { start_date: 'asc' } });
  console.log(`\nTerms in DB (${dbTerms.length}):`,
    dbTerms.map(t => `[${t.id.slice(0,6)}] ${t.name}`).join(' | ') || 'NONE');

  /**
   * findTermForCycle — given a cycle number (1/2/3) find the best matching
   * active term in DB.  Strategy:
   *   - "Term 1" in name → cycle 1,  "Term 2" → cycle 2,  "Term 3" → cycle 3
   *   - If no match, use the most recent active term as fallback.
   */
  function findTermForCycle(cycleNum) {
    if (!cycleNum || dbTerms.length === 0) return null;
    // Try matching term number in name  e.g. "Term 1 2024/2025"
    const byName = dbTerms.find(t =>
      t.name.includes(`Term ${cycleNum}`) || t.name.includes(`term ${cycleNum}`)
    );
    if (byName) return byName;
    // Positional fallback: cycle 1 → index 0, cycle 2 → index 1, etc.
    return dbTerms[cycleNum - 1] || dbTerms[dbTerms.length - 1] || null;
  }

  // ── Load workbook ────────────────────────────────────────────────────────
  console.log(`\nLoading: ${EXCEL_PATH}`);
  const wb = XLSX.readFile(EXCEL_PATH);

  const SHEET_ORDER = SINGLE_SHEET
    ? [SINGLE_SHEET]
    : ['ALL', 'CONTINUING', 'COMPLETED', 'DESERTED', 'ATTACHMENT', 'DECEASED'];

  const stats       = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  const seenAdmNos  = new Set();   // cross-sheet dedup

  const hashedPassword = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  for (const sheetName of SHEET_ORDER) {
    if (!wb.SheetNames.includes(sheetName)) continue;

    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📄  Sheet: ${sheetName}`);

    const ws      = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (rawRows.length < 2) { console.log('  (empty)'); continue; }

    const headerRow = rawRows[0];

    const findCol = (...keywords) => {
      const i = headerRow.findIndex(h =>
        h && keywords.some(k => String(h).toLowerCase().includes(k.toLowerCase()))
      );
      return i >= 0 ? i : null;
    };

    const COL = {
      sno:    findCol('S/NO', 'S NO'),
      names:  findCol('NAMES', 'NAME'),
      kcpe:   findCol('KCPE'),
      kcse:   findCol('KCSE'),
      course: findCol('COURSE'),
      adm_no: findCol('ADM NO', 'ADM.NO', 'REG NO', 'REGISTRATION'),
      gender: findCol('GENDER'),
      phone:  findCol('PHONE'),
      email:  findCol('EMAIL', 'E-MAIL'),   // rarely present; null if absent
      level:  findCol('LEVEL'),
      period: findCol('ADMISSION PERIOD', 'PERIOD'),
      cycle:  findCol('CYCLE', 'Cycle'),
      status: findCol('STATUS'),
    };

    let ins = 0, upd = 0, skp = 0;

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row?.length) continue;

      // Skip department header rows (S/NO is text) and blank rows
      const sno = COL.sno !== null ? row[COL.sno] : null;
      if (sno === null || sno === undefined || typeof sno === 'string') continue;

      // ── Extract raw values ──────────────────────────────────────────────
      const admRaw    = COL.adm_no !== null ? row[COL.adm_no] : null;
      const namesRaw  = COL.names  !== null ? row[COL.names]  : null;
      const courseRaw = COL.course !== null ? row[COL.course] : null;
      const genderRaw = COL.gender !== null ? row[COL.gender] : null;
      const phoneRaw  = COL.phone  !== null ? row[COL.phone]  : null;
      const emailRaw  = COL.email  !== null ? row[COL.email]  : null;
      const levelRaw  = COL.level  !== null ? row[COL.level]  : null;
      const periodRaw = COL.period !== null ? row[COL.period] : null;
      const cycleRaw  = COL.cycle  !== null ? row[COL.cycle]  : null;
      const statusRaw = COL.status !== null ? row[COL.status] : null;
      const kcseRaw   = COL.kcse   !== null ? row[COL.kcse]   : null;
      const kcpeRaw   = COL.kcpe   !== null ? row[COL.kcpe]   : null;

      // ── Validate ADM NO ─────────────────────────────────────────────────
      if (!admRaw || String(admRaw).trim().length < 3) {
        stats.errors.push({ sheet: sheetName, row: i + 1, names: namesRaw, error: 'Missing/invalid ADM NO' });
        skp++;
        continue;
      }

      const admNo = cleanAdmNo(admRaw);   // kept exactly as in Excel

      // ── Normalize fields ────────────────────────────────────────────────
      const { surname, other_names }  = splitName(namesRaw);
      const gender                    = normalizeGender(genderRaw);
      const phone                     = phoneRaw ? String(phoneRaw).replace(/[^0-9+]/g, '') : null;
      const level                     = normalizeLevel(levelRaw);
      const { intake, year }          = parseAdmissionPeriod(periodRaw);
      const status                    = normalizeStatus(statusRaw);
      const kcse_index                = kcseRaw ? String(kcseRaw).trim() : null;
      const kcpe_index                = kcpeRaw ? String(kcpeRaw).trim() : null;
      const cycleNum                  = parseCycle(cycleRaw);
      const matchedTerm               = findTermForCycle(cycleNum);
      const courseMatch               = matchCourse(courseRaw);

      // ── Resolve email: Excel value if valid, else filler ────────────────
      let email = fillerEmail(admNo);
      if (emailRaw) {
        const trimmed = String(emailRaw).trim().toLowerCase();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) email = trimmed;
      }

      if (!courseMatch) {
        stats.errors.push({
          sheet: sheetName, row: i + 1,
          adm_no: admNo, names: namesRaw,
          error: `Course not matched: "${courseRaw}"`,
        });
        skp++;
        continue;
      }

      if (DRY_RUN) {
        console.log(
          `  [DRY] ${admNo} | ${namesRaw} | ${courseMatch.shortcode} | ${level}` +
          ` | ${intake} ${year} | ${status}` +
          ` | cycle:${cycleNum || '-'} → term:${matchedTerm?.name || 'none'}` +
          ` | email:${email}`
        );
        seenAdmNos.add(admNo);
        ins++;
        continue;
      }

      try {
        // ── Check if student already exists ──────────────────────────────
        const existing = await prisma.student.findUnique({
          where: { admission_no: admNo },
          include: { application: true },
        });

        if (existing) {
          // UPDATE — only fill in missing/changed fields
          const studentUp = {};
          if (existing.status !== status)   studentUp.status = status;
          if (existing.level  !== level)    studentUp.level  = level;
          if (existing.intake !== intake)   studentUp.intake = intake;
          if (existing.year   !== year)     studentUp.year   = year;
          // Assign term if one matched and student doesn't have one yet
          if (matchedTerm && !existing.current_term_id)
            studentUp.current_term_id = matchedTerm.id;

          const appUp = {};
          if (!existing.application?.kcse_index && kcse_index) appUp.kcse_index = kcse_index;
          if (!existing.application?.kcpe_index && kcpe_index) appUp.kcpe_index = kcpe_index;
          if (!existing.application?.gender || existing.application.gender === 'Other')
            appUp.gender = gender;
          // Update phone only if DB still holds placeholder
          if (phone && phone.length >= 9 &&
              (!existing.application?.phone || existing.application.phone === '0000000000'))
            appUp.phone = phone;

          if (Object.keys(studentUp).length)
            await prisma.student.update({ where: { admission_no: admNo }, data: studentUp });
          if (Object.keys(appUp).length && existing.application)
            await prisma.application.update({ where: { id: existing.application.id }, data: appUp });

          console.log(`  ✏  UPDATED : ${admNo} — ${Object.keys({ ...studentUp, ...appUp }).join(', ') || 'no changes'}`);
          upd++;
          stats.updated++;

        } else if (!seenAdmNos.has(admNo)) {
          // INSERT — brand new student
          const finalEmail = await uniqueEmail(email);

          await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
              data: {
                email: finalEmail,
                password: hashedPassword,
                role: 'STUDENT',
                must_change_password: true,  // student must change password on first login
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
                date_of_birth: new Date('2000-01-01'), // DOB placeholder — student can update
                email: finalEmail,
                phone: (phone && phone.length >= 9) ? phone : '0000000000', // placeholder if missing
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
                admission_no: admNo,          // kept exactly as in Excel
                user_id: user.id,
                application_id: application.id,
                course_id: courseMatch.id,
                department_id: courseMatch.department_id,
                level,
                intake,
                year,
                status,
                // Assign current term based on cycle number from Excel
                ...(matchedTerm ? { current_term_id: matchedTerm.id } : {}),
              },
            });
          });

          console.log(
            `  ✅  INSERTED: ${admNo} — ${namesRaw}` +
            ` (${courseMatch.shortcode}, ${status}` +
            `, term:${matchedTerm?.name || 'none'}` +
            `, login:${finalEmail})`
          );
          seenAdmNos.add(admNo);
          ins++;
          stats.inserted++;

        } else {
          console.log(`  ⏭  SKIP (already processed this session): ${admNo}`);
          skp++;
          stats.skipped++;
        }

      } catch (err) {
        console.error(`  ❌  ERROR row ${i + 1} (${admNo}): ${err.message}`);
        stats.errors.push({ sheet: sheetName, row: i + 1, adm_no: admNo, names: namesRaw, error: err.message });
        skp++;
      }
    }

    console.log(`\n  Sheet "${sheetName}": +${ins} inserted, ~${upd} updated, ${skp} skipped`);
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log('IMPORT SUMMARY');
  console.log('='.repeat(70));
  console.log(`✅  Inserted : ${stats.inserted}`);
  console.log(`✏   Updated  : ${stats.updated}`);
  console.log(`⏭   Skipped  : ${stats.skipped}`);
  console.log(`❌  Errors   : ${stats.errors.length}`);

  if (stats.errors.length) {
    console.log('\nErrors (rows needing manual attention):');
    stats.errors.forEach((e, idx) =>
      console.log(`  ${idx + 1}. [${e.sheet}] Row ${e.row} | ${e.adm_no || '—'} | ${e.names || '—'} → ${e.error}`)
    );
  }

  console.log(`\nDefault login for all imported students:`);
  console.log(`  Email    : {adm_no_cleaned}@${EMAIL_DOMAIN}  e.g. cee0022024m@${EMAIL_DOMAIN}`);
  console.log(`  Password : ${DEFAULT_PASSWORD}`);
  console.log(`  Note     : Students are required to change password on first login.`);
  console.log(`             They can then update email, phone, DOB, ID number from their profile.`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatal:', err.message);
  await prisma.$disconnect();
  process.exit(1);
});

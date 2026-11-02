const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../config/db');
const { generateAdmissionNumber, getMonthShortcode } = require('../utils/admissionNumberGenerator');
const { levelCodeOf } = require('../utils/levels');
const { createStudentBalance, reconcileStudent } = require('./billingService');
const {
  text, normGender, normLevel, normIntake, normYear, normDate, normPhone, normEmail, normStatus, EMAIL_RE,
} = require('../utils/spreadsheet');

const MAX_ROWS = 1000;
const PLACEHOLDER_DOB = new Date(Date.UTC(2000, 0, 1));
const PLACEHOLDER_PHONE = '0000000000';

const key = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

const newAppNo = () => `NTVC/APP/${new Date().getFullYear()}/${crypto.randomInt(100000, 999999)}`;

// A temporary password: easy to read out, hard to guess. The student must change it at first login.
const tempPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 9; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return `${out}#${crypto.randomInt(10, 99)}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSE: check every row against the courses, terms and students on file. Writes nothing.
// Each row ends up 'ready', 'duplicate' (looks like a student who exists) or 'error'.
// ─────────────────────────────────────────────────────────────────────────────
const analyzeRows = async (rows, { allowSimilar = false } = {}) => {
  if (rows.length === 0) throw Object.assign(new Error('The file has no student rows.'), { status: 400 });
  if (rows.length > MAX_ROWS) throw Object.assign(new Error(`The file has ${rows.length} rows. Import at most ${MAX_ROWS} at a time.`), { status: 400 });

  const [courses, terms] = await Promise.all([
    prisma.course.findMany({ include: { department: { select: { id: true, name: true } } } }),
    prisma.term.findMany(),
  ]);

  const findCourse = (v) => {
    const k = key(v);
    return courses.find((c) => key(c.name) === k || key(c.shortcode) === k || c.id === v) || null;
  };
  const findTerm = (v) => {
    const k = key(v);
    return terms.find((t) => key(t.name) === k || `${key(t.name)} ${key(t.academic_year)}` === k || t.id === v) || null;
  };

  // Clean each row
  const cleaned = rows.map((raw, i) => {
    const errors = [];
    const warnings = [];

    let surname = text(raw.surname);
    let other_names = text(raw.other_names);
    if (!surname && text(raw.full_name)) {
      const parts = text(raw.full_name).split(/\s+/);
      surname = parts.shift();
      other_names = other_names || parts.join(' ');
    }
    if (!surname) errors.push('Surname (or Name) is required');

    const course = text(raw.course) ? findCourse(raw.course) : null;
    if (!text(raw.course)) errors.push('Course is required');
    else if (!course) errors.push(`Course "${text(raw.course)}" was not found. Use a name or code from the Courses sheet`);

    const level = normLevel(raw.level);
    if (!text(raw.level)) errors.push('Level is required');
    else if (!level) errors.push(`Level "${text(raw.level)}" is not recognised. Use Level 3, 4, 5…`);

    let intake = normIntake(raw.intake);
    if (intake === undefined) { errors.push(`Intake "${text(raw.intake)}" is not recognised. Use January, May or September`); intake = null; }

    let year = normYear(raw.year);
    if (text(raw.year) && !year) errors.push(`Year "${text(raw.year)}" is not valid`);

    const term = text(raw.term) ? findTerm(raw.term) : null;
    if (text(raw.term) && !term) errors.push(`Term "${text(raw.term)}" was not found. Use a name from the Terms sheet`);

    // A term can say which intake and year the student is in
    if (!intake) intake = term && ['JANUARY', 'MAY', 'SEPTEMBER'].includes(term.intake) ? term.intake : null;
    if (!intake) { intake = 'SEPTEMBER'; warnings.push('No intake given, September assumed'); }
    if (!year) { year = term?.start_date ? new Date(term.start_date).getFullYear() : new Date().getFullYear(); warnings.push(`No year given, ${year} assumed`); }

    let dob = normDate(raw.dob);
    if (text(raw.dob) || raw.dob instanceof Date) {
      if (!dob) { errors.push(`Date of birth "${text(raw.dob)}" is not a valid date. Use 2004-03-05 or 05/03/2004`); }
    }
    if (!dob && !errors.some((e) => e.startsWith('Date of birth'))) { dob = PLACEHOLDER_DOB; warnings.push('No date of birth, 1 Jan 2000 used as a placeholder'); }

    const email = normEmail(raw.email);
    if (email && !EMAIL_RE.test(email)) errors.push(`Email "${email}" is not valid`);

    const phone = normPhone(raw.phone) || PLACEHOLDER_PHONE;
    if (!normPhone(raw.phone)) warnings.push('No phone number');

    const status = normStatus(raw.status);
    if (status === undefined) errors.push(`Status "${text(raw.status)}" is not recognised`);

    let amountPaid = null;
    if (text(raw.amount_paid)) {
      amountPaid = parseFloat(String(raw.amount_paid).replace(/[, ]/g, ''));
      if (isNaN(amountPaid) || amountPaid < 0) errors.push(`Amount paid "${text(raw.amount_paid)}" is not a valid amount`);
      else if (amountPaid > 0 && !term) errors.push('Amount paid needs a Term to record it against');
    }

    return {
      row: i + 2, // spreadsheet row number: row 1 is the header
      errors, warnings,
      d: {
        admission_no: text(raw.admission_no) || null,
        surname, other_names, gender: normGender(raw.gender), dob,
        id_number: text(raw.id_number) || null,
        phone, email: email || null,
        course, level, intake, year, term, status: status || 'ACTIVE', amountPaid,
      },
    };
  });

  // Look for students that already exist (one query each, not one per row)
  const admNos = cleaned.map((c) => c.d.admission_no).filter(Boolean);
  const emails = cleaned.map((c) => c.d.email).filter(Boolean);
  const idNos = cleaned.map((c) => c.d.id_number).filter(Boolean);
  const nameDobs = cleaned.filter((c) => c.d.surname && c.d.dob && c.d.dob.getTime() !== PLACEHOLDER_DOB.getTime());

  const [existingAdm, existingUsers, existingIds, existingNames] = await Promise.all([
    admNos.length ? prisma.student.findMany({ where: { admission_no: { in: admNos } }, select: { admission_no: true } }) : [],
    emails.length ? prisma.user.findMany({ where: { email: { in: emails } }, select: { email: true } }) : [],
    idNos.length ? prisma.application.findMany({ where: { id_number: { in: idNos }, student: { isNot: null } }, select: { id_number: true, student: { select: { admission_no: true } } } }) : [],
    nameDobs.length
      ? prisma.application.findMany({
          where: {
            student: { isNot: null },
            OR: nameDobs.map((c) => ({
              surname: { equals: c.d.surname, mode: 'insensitive' },
              other_names: { equals: c.d.other_names || '', mode: 'insensitive' },
              date_of_birth: c.d.dob,
            })),
          },
          select: { surname: true, other_names: true, date_of_birth: true, student: { select: { admission_no: true } } },
        })
      : [],
  ]);
  const admSet = new Set(existingAdm.map((s) => s.admission_no.toLowerCase()));
  const emailSet = new Set(existingUsers.map((u) => u.email.toLowerCase()));
  const idMap = new Map(existingIds.map((a) => [a.id_number, a.student?.admission_no]));
  const nameMap = new Map(existingNames.map((a) => [`${key(a.surname)}|${key(a.other_names)}|${a.date_of_birth.toISOString().slice(0, 10)}`, a.student?.admission_no]));

  // The same student twice in one file
  const seenAdm = new Map();
  const seenEmail = new Map();
  const seenId = new Map();

  return cleaned.map((c) => {
    const { d } = c;
    const out = {
      row: c.row,
      status: 'ready',
      admission_no: d.admission_no,
      name: `${d.surname} ${d.other_names}`.trim(),
      course: d.course?.name || null,
      level: d.level,
      intake: d.intake,
      year: d.year,
      term: d.term?.name || null,
      messages: [...c.errors],
      warnings: [...c.warnings],
      similar: null,
      d,
    };

    if (d.admission_no) {
      const k = d.admission_no.toLowerCase();
      if (admSet.has(k)) out.messages.push(`Admission number ${d.admission_no} already exists`);
      if (seenAdm.has(k)) out.messages.push(`Admission number ${d.admission_no} is also on row ${seenAdm.get(k)}`);
      seenAdm.set(k, seenAdm.get(k) ?? c.row);
    } else {
      out.warnings.push('Admission number will be generated');
    }
    if (d.email) {
      if (emailSet.has(d.email)) out.messages.push(`Email ${d.email} is already used by another account`);
      if (seenEmail.has(d.email)) out.messages.push(`Email ${d.email} is also on row ${seenEmail.get(d.email)}`);
      seenEmail.set(d.email, seenEmail.get(d.email) ?? c.row);
    } else {
      out.warnings.push('No email, one will be made from the admission number');
    }

    let duplicate = false;

    // Looks like a student who already exists, even under another admission number
    if (d.id_number) {
      if (idMap.has(d.id_number)) { out.similar = { admission_no: idMap.get(d.id_number), reason: 'same ID number' }; duplicate = true; }
      if (seenId.has(d.id_number)) { out.messages.push(`ID number ${d.id_number} is also on row ${seenId.get(d.id_number)}`); }
      seenId.set(d.id_number, seenId.get(d.id_number) ?? c.row);
    }
    if (!out.similar && d.dob) {
      const nk = `${key(d.surname)}|${key(d.other_names)}|${d.dob.toISOString().slice(0, 10)}`;
      if (nameMap.has(nk)) { out.similar = { admission_no: nameMap.get(nk), reason: 'same name and date of birth' }; duplicate = true; }
    }

    if (out.messages.length > 0) out.status = 'error';
    else if (duplicate && !allowSimilar) {
      out.status = 'duplicate';
      out.messages.push(`Looks like existing student ${out.similar.admission_no} (${out.similar.reason}). Use "Link" or "Continue" on that student instead, or tick "Import anyway".`);
    }
    return out;
  });
};

const summarize = (analyzed) => ({
  total: analyzed.length,
  ready: analyzed.filter((r) => r.status === 'ready').length,
  duplicates: analyzed.filter((r) => r.status === 'duplicate').length,
  errors: analyzed.filter((r) => r.status === 'error').length,
  with_warnings: analyzed.filter((r) => r.status === 'ready' && r.warnings.length > 0).length,
});

// Rows without the cleaned data, for sending to the browser
const publicRows = (analyzed) => analyzed.map(({ d, ...rest }) => rest);

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT: create the accounts, students, and (when a term is given) the term balance and opening payment
// ─────────────────────────────────────────────────────────────────────────────
const importRows = async (analyzed, userId) => {
  const result = { created: 0, failed: 0, errors: [], credentials: [] };

  for (const r of analyzed.filter((x) => x.status === 'ready')) {
    const d = r.d;
    try {
      // Generated one at a time: the next number depends on the students just created
      const admission_no = d.admission_no || await generateAdmissionNumber(d.course.id, levelCodeOf(d.level), d.intake, d.year);
      const email = d.email || `${admission_no.replace(/[^a-z0-9]/gi, '').toLowerCase()}@ntvc.ac.ke`;

      if (await prisma.student.findUnique({ where: { admission_no } })) throw new Error(`Admission number ${admission_no} already exists`);
      if (await prisma.user.findUnique({ where: { email } })) throw new Error(`Email ${email} is already used by another account`);

      const password = tempPassword();
      const hashed = await bcrypt.hash(password, 10);

      const student = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email, password: hashed, role: 'STUDENT', must_change_password: true, is_active: true } });
        const application = await tx.application.create({
          data: {
            application_no: newAppNo(),
            type: 'DIRECT',
            surname: d.surname,
            other_names: d.other_names,
            gender: d.gender,
            date_of_birth: d.dob,
            id_number: d.id_number,
            email,
            phone: d.phone,
            course_id: d.course.id,
            department_id: d.course.department_id,
            level_applied: d.level,
            status: 'APPROVED',
          },
        });
        return tx.student.create({
          data: {
            admission_no,
            user_id: user.id,
            application_id: application.id,
            course_id: d.course.id,
            department_id: d.course.department_id,
            level: d.level,
            intake: d.intake,
            year: d.year,
            admission_month_shortcode: getMonthShortcode(d.intake),
            status: d.status,
            ...(d.term && { current_term_id: d.term.id }),
          },
        });
      });

      // Term, fees and any opening payment go through the billing engine
      if (d.term) {
        await createStudentBalance(student.id, d.term.id, d.level);
        if (d.amountPaid > 0) {
          await prisma.feeRecord.create({
            data: { student_id: student.id, term_id: d.term.id, amount: d.amountPaid, received_by: userId, notes: 'Opening payment from student import' },
          });
          await reconcileStudent(student.id);
        }
      }

      result.created += 1;
      result.credentials.push({ admission_no, name: r.name, email, password });
    } catch (err) {
      result.failed += 1;
      result.errors.push({ row: r.row, name: r.name, error: err.message });
    }
  }
  return result;
};

module.exports = { analyzeRows, summarize, publicRows, importRows, MAX_ROWS };

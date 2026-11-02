const XLSX = require('xlsx');

// ─────────────────────────────────────────────────────────────────────────────
// Reading student spreadsheets (CSV, XLS, XLSX)
// Column names are matched loosely ("Reg No", "reg_no", "Registration Number" all mean admission_no).
// ─────────────────────────────────────────────────────────────────────────────

const ALIASES = {
  admission_no: ['admissionno', 'admissionnumber', 'admno', 'admission', 'regno', 'registrationno', 'registrationnumber', 'regnumber', 'regnum'],
  surname: ['surname', 'lastname', 'secondname', 'familyname'],
  other_names: ['othernames', 'othername', 'firstname', 'firstnames', 'forenames', 'givennames'],
  full_name: ['name', 'fullname', 'studentname', 'names', 'nameofstudent'],
  gender: ['gender', 'sex'],
  dob: ['dob', 'dateofbirth', 'birthdate', 'dateborn'],
  id_number: ['idnumber', 'idno', 'nationalid', 'nationalidno', 'nationalidnumber', 'idnonationalid'],
  phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'tel', 'telephone', 'contact', 'phoneno'],
  email: ['email', 'emailaddress', 'mail'],
  course: ['course', 'coursename', 'program', 'programme', 'trade'],
  level: ['level', 'levelofstudy', 'currentlevel'],
  intake: ['intake', 'intakemonth', 'admissionmonth'],
  year: ['year', 'intakeyear', 'admissionyear', 'yearofadmission'],
  term: ['term', 'currentterm', 'termname'],
  amount_paid: ['amountpaid', 'feespaid', 'paid', 'totalpaid', 'feepaid'],
  status: ['status', 'studentstatus'],
};

const squash = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const HEADER_TO_FIELD = {};
for (const [field, names] of Object.entries(ALIASES)) {
  HEADER_TO_FIELD[field] = field; // the field's own name always works
  for (const n of names) HEADER_TO_FIELD[n] = field;
  HEADER_TO_FIELD[squash(field)] = field;
}

// Buffer of a .csv / .xls / .xlsx file -> { rows: [{ field: value }], ignored: [header], sheet }
const readStudentSheet = (buffer, filename = '') => {
  // A CSV is plain text. Reading it as text keeps 0712… phone numbers intact and stops 05/03/2004 being
  // read month-first. Excel files carry real dates and numbers.
  const isCsv = /\.csv$/i.test(filename);
  let wb;
  try {
    wb = XLSX.read(buffer, isCsv ? { type: 'buffer', raw: true } : { type: 'buffer', cellDates: true });
  } catch (e) {
    throw Object.assign(new Error('That file could not be read. Upload a CSV, XLS or XLSX file.'), { status: 400 });
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw Object.assign(new Error('The file has no data.'), { status: 400 });

  // raw: true keeps real dates as Date objects and numbers as numbers; blank cells become ''
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: true });
  const ignored = new Set();
  const rows = [];

  for (const raw of rawRows) {
    const row = {};
    for (const [header, value] of Object.entries(raw)) {
      const field = HEADER_TO_FIELD[squash(header)];
      if (!field) { if (String(header).trim() && !String(header).startsWith('__EMPTY')) ignored.add(String(header).trim()); continue; }
      // the first column mapped to a field wins
      if (row[field] === undefined || row[field] === '') row[field] = value;
    }
    // skip rows that are completely empty
    if (Object.values(row).every((v) => v === '' || v === null || v === undefined)) continue;
    rows.push(row);
  }
  return { rows, ignored: [...ignored], sheet: sheetName };
};

// ── Cleaning individual values ───────────────────────────────────────────────

const text = (v) => (v instanceof Date ? '' : String(v ?? '').trim());

const normGender = (v) => {
  const g = text(v).toLowerCase();
  if (['m', 'male', 'man', 'boy'].includes(g)) return 'Male';
  if (['f', 'female', 'woman', 'girl'].includes(g)) return 'Female';
  return g ? 'Other' : 'Other';
};

// "Level 5", "L5", "5" -> "Level 5"
const normLevel = (v) => {
  const m = text(v).match(/\d+/);
  return m ? `Level ${m[0]}` : null;
};

const normIntake = (v) => {
  const s = text(v).toLowerCase();
  if (!s) return null;
  if (s.startsWith('jan') || s === 'j') return 'JANUARY';
  if (s.startsWith('may') || s === 'm') return 'MAY';
  if (s.startsWith('sep') || s === 's') return 'SEPTEMBER';
  return undefined; // given but not recognised
};

const normYear = (v) => {
  const y = parseInt(text(v), 10);
  return y >= 1990 && y <= 2100 ? y : null;
};

// Real dates, Excel serial numbers, 2004-03-05, 05/03/2004 (day first) and 5-3-04
const normDate = (v) => {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === 'number' && v > 1000 && v < 100000) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? new Date(Date.UTC(d.y, d.m - 1, d.d)) : null;
  }
  const s = text(v);
  if (!s) return null;
  let y, m, d;
  let mt = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (mt) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/))) {
    d = +mt[1]; m = +mt[2]; y = +mt[3];
    if (y < 100) y += y > 30 ? 1900 : 2000;
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 ? date : null;
};

// Excel drops the leading zero of phone numbers; put it back
const normPhone = (v) => {
  let s = typeof v === 'number' ? String(Math.trunc(v)) : text(v);
  s = s.replace(/[\s\-()]/g, '');
  if (/^\d{9}$/.test(s) && /^[17]/.test(s)) s = `0${s}`;
  return s;
};

const normEmail = (v) => text(v).toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normStatus = (v) => {
  const s = text(v).toUpperCase();
  if (!s) return 'ACTIVE';
  return ['ACTIVE', 'DEFERRED', 'GRADUATED', 'WITHDRAWN', 'ATTACHMENT'].includes(s) ? s : undefined;
};

// ── Template ─────────────────────────────────────────────────────────────────

const TEMPLATE_COLUMNS = [
  ['admission_no', 'Admission No'],
  ['surname', 'Surname'],
  ['other_names', 'Other Names'],
  ['gender', 'Gender'],
  ['dob', 'Date of Birth'],
  ['id_number', 'ID Number'],
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['course', 'Course'],
  ['level', 'Level'],
  ['intake', 'Intake'],
  ['year', 'Year'],
  ['term', 'Term'],
  ['amount_paid', 'Amount Paid'],
  ['status', 'Status'],
];

// courses: [{ name, shortcode }], terms: [{ name, academic_year }]
const buildTemplate = (courses = [], terms = []) => {
  const wb = XLSX.utils.book_new();

  const header = TEMPLATE_COLUMNS.map(([, label]) => label);
  const c1 = courses[0];
  const examples = [
    ['', 'Otieno', 'Jane Achieng', 'Female', '2004-03-05', '12345678', '0712345678', 'jane@example.com', c1?.shortcode || 'COURSE-CODE', 'Level 5', 'September', 2026, terms[0]?.name || '', 0, 'Active'],
    ['', 'Kamau', 'John', 'Male', '05/03/2003', '', '0722000000', '', c1?.name || 'Course name', 'Level 4', 'January', 2026, '', '', ''],
  ];
  const students = XLSX.utils.aoa_to_sheet([header, ...examples]);
  students['!cols'] = header.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  students['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, students, 'Students');

  const help = [
    ['Column', 'Required?', 'What to put there'],
    ['Admission No', 'No', 'Leave blank to have one generated for the course, level, intake and year. If given, it must not already exist.'],
    ['Surname', 'Yes*', 'Family name. *Or use a single "Name" column with the surname first.'],
    ['Other Names', 'No', 'First and middle names.'],
    ['Gender', 'No', 'Male or Female (M / F also work).'],
    ['Date of Birth', 'Recommended', 'e.g. 2004-03-05 or 05/03/2004 (day first). A placeholder date is used when missing, so update it later.'],
    ['ID Number', 'No', 'National ID. Used to spot students who already exist.'],
    ['Phone', 'No', 'e.g. 0712345678'],
    ['Email', 'No', 'Used for the student login. If blank, one is made from the admission number. Must not already be used.'],
    ['Course', 'Yes', 'Course name or course code, exactly as listed on the "Courses" sheet.'],
    ['Level', 'Yes', 'Level 3, Level 4, Level 5 … ("L5" and "5" also work).'],
    ['Intake', 'Recommended', 'January, May or September. Defaults to September.'],
    ['Year', 'Recommended', 'Year of admission, e.g. 2026. Defaults to the current year.'],
    ['Term', 'No', 'A term name from the "Terms" sheet. The student is assigned to it and fees are calculated.'],
    ['Amount Paid', 'No', 'Fees already paid for that term. Recorded as an opening payment. Needs a Term.'],
    ['Status', 'No', 'Active (default), Deferred, Graduated, Withdrawn or Attachment.'],
  ];
  const helpSheet = XLSX.utils.aoa_to_sheet(help);
  helpSheet['!cols'] = [{ wch: 16 }, { wch: 13 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, helpSheet, 'Instructions');

  const courseSheet = XLSX.utils.aoa_to_sheet([['Course name', 'Course code'], ...courses.map((c) => [c.name, c.shortcode])]);
  courseSheet['!cols'] = [{ wch: 50 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, courseSheet, 'Courses');

  const termSheet = XLSX.utils.aoa_to_sheet([['Term', 'Academic year'], ...terms.map((t) => [t.name, t.academic_year])]);
  termSheet['!cols'] = [{ wch: 24 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, termSheet, 'Terms');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
};

module.exports = {
  readStudentSheet,
  buildTemplate,
  text, normGender, normLevel, normIntake, normYear, normDate, normPhone, normEmail, normStatus, EMAIL_RE,
};

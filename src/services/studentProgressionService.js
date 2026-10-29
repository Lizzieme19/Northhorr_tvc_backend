const prisma = require('../config/db');
const { generateAdmissionNumber, getMonthShortcode } = require('../utils/admissionNumberGenerator');

// "Level 5", "L5" and "5" are all in use; admission numbers use the "L5" form
const levelCodeOf = (level) => {
  const m = String(level || '').match(/\d+/);
  return m ? `L${m[0]}` : String(level || '');
};

const academicYearOf = (year) => `${year}/${year + 1}`;

const sameLevel = (a, b) => levelCodeOf(a) === levelCodeOf(b);

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS A STUDENT
// One student record continues through the levels. Each move to a new level gets a new admission
// number, and the stage being left is written to StudentProgression so nothing is lost.
// ─────────────────────────────────────────────────────────────────────────────
//
// opts: { studentId, term, newLevel?, newIntake?, newYear?, newCourseId?, newDepartmentId?,
//         notes?, userId, kind? }
// A new level (or kind RE_ADMISSION, an approved returning applicant) starts a new stage: new admission
// number, new intake/year, history entry. Moving to a new term at the same level only adds a balance row.
const progressStudent = async (opts) => {
  const { studentId, term, newLevel, newIntake, newYear, newCourseId, newDepartmentId, notes, userId, kind = 'PROMOTION' } = opts;

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { course: { select: { name: true } } },
  });
  if (!student) throw Object.assign(new Error('Student not found'), { status: 404 });

  const existingBalance = await prisma.studentBalance.findUnique({
    where: { student_term: { student_id: studentId, term_id: term.id } },
  });
  if (existingBalance) throw Object.assign(new Error('Student already enrolled in this term'), { status: 400 });

  // Debt (or credit) carried from the current term
  let carryoverAmount = 0;
  let carryoverNotes = '';
  let carriedFromTermId = null;
  if (student.current_term_id) {
    const previous = await prisma.studentBalance.findUnique({
      where: { student_term: { student_id: studentId, term_id: student.current_term_id } },
    });
    if (previous) {
      carryoverAmount = previous.balance;
      carriedFromTermId = student.current_term_id;
      if (carryoverAmount > 0) carryoverNotes = `Balance of KES ${carryoverAmount} carried forward from previous term`;
      else if (carryoverAmount < 0) carryoverNotes = `Credit of KES ${Math.abs(carryoverAmount)} carried forward from previous term`;
    }
  }

  let totalFees = term.term_cost || 0;
  if (student.fee_adjustment && student.fee_adjustment > 0) {
    totalFees -= student.fee_adjustment;
    carryoverNotes += `${carryoverNotes ? '. ' : ''}Fee adjustment of KES ${student.fee_adjustment} applied`;
  }
  const levelForFees = newLevel || student.level;
  const newBalance = totalFees + carryoverAmount;
  const status = newBalance <= 0 ? 'PAID' : newBalance < totalFees ? 'PARTIAL' : 'PENDING';

  const levelChanged = Boolean(newLevel) && !sameLevel(newLevel, student.level);
  const newStage = levelChanged || kind === 'RE_ADMISSION';

  // The stage being entered
  // Defaults come from the term being entered, then from the student's current intake/year
  const termIntake = ['JANUARY', 'MAY', 'SEPTEMBER'].includes(term.intake) ? term.intake : null;
  const termYear = term.start_date ? new Date(term.start_date).getFullYear() : null;
  const toIntake = newStage ? (newIntake || termIntake || student.intake) : student.intake;
  const toYear = newStage ? (parseInt(newYear) || termYear || student.year) : student.year;
  const courseId = newCourseId || student.course_id;
  const departmentId = newDepartmentId || student.department_id;

  let newAdmissionNo = student.admission_no;
  if (newStage) {
    try {
      newAdmissionNo = await generateAdmissionNumber(courseId, levelCodeOf(levelForFees), toIntake, toYear);
    } catch (err) {
      console.warn('Could not generate new admission number, keeping existing:', err.message);
    }
  }

  let toCourseName = student.course?.name || null;
  if (newCourseId && newCourseId !== student.course_id) {
    const c = await prisma.course.findUnique({ where: { id: newCourseId }, select: { name: true } });
    toCourseName = c?.name || toCourseName;
  }

  const effectiveDate = term.start_date || new Date();

  const writes = [
    prisma.studentBalance.create({
      data: {
        student_id: studentId,
        term_id: term.id,
        level: levelForFees,
        total_fees: totalFees,
        amount_paid: 0,
        balance: newBalance,
        status,
        previous_balance_carryover: carryoverAmount,
        carried_from_term_id: carriedFromTermId,
        carryover_notes: carryoverNotes || null,
      },
    }),
    prisma.student.update({
      where: { id: studentId },
      data: {
        current_term_id: term.id,
        level: levelForFees,
        // A returning student who had graduated, deferred or withdrawn is active again
        ...(newStage && { status: 'ACTIVE', intake: toIntake, year: toYear, admission_month_shortcode: getMonthShortcode(toIntake), admission_no: newAdmissionNo }),
        ...(newCourseId && { course_id: courseId }),
        ...(newDepartmentId && { department_id: departmentId }),
      },
    }),
  ];

  if (newStage) {
    const previousStatusNote = student.status !== 'ACTIVE' ? ` (previous status: ${student.status})` : '';
    writes.push(
      prisma.studentProgression.create({
        data: {
          student_id: studentId,
          from_level: student.level,
          to_level: levelForFees,
          term_id: term.id,
          academic_year: term.academic_year,
          promoted_by: userId,
          notes: (notes || (kind === 'RE_ADMISSION' ? `Re-admitted to ${levelForFees}` : `Promoted from ${student.level} to ${levelForFees}`)) + previousStatusNote,
          fee_clearance: carryoverAmount <= 0,
          old_admission_no: student.admission_no,
          new_admission_no: newAdmissionNo,
          from_intake: student.intake,
          from_year: student.year,
          to_intake: toIntake,
          to_year: toYear,
          from_course_name: student.course?.name || null,
          to_course_name: toCourseName,
          from_started_at: student.created_at,
          effective_date: effectiveDate,
          kind,
        },
      })
    );
  }

  const results = await prisma.$transaction(writes);
  return {
    student: results[1],
    balance: results[0],
    progression: newStage ? results[2] : null,
    carryover: { amount: carryoverAmount, from_term_id: carriedFromTermId, notes: carryoverNotes },
    newAdmissionNo,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY TIMELINE
// Every stage a student has been through: level, admission number, intake, year, dates.
// The first stage and any gaps in older records are filled from what is on file.
// ─────────────────────────────────────────────────────────────────────────────
const startOf = (p) => p.effective_date || p.created_at;

const buildTimeline = (student, progressions = []) => {
  const entries = [...progressions].sort((a, b) => new Date(startOf(a)) - new Date(startOf(b)));
  const first = entries[0];
  // Progressions recorded before intake history existed have no intake/year at all
  const anyIntakeRecorded = entries.some((e) => e.from_intake || e.to_intake);

  const stages = [];
  stages.push({
    level: first ? first.from_level : student.level,
    admission_no: first ? first.old_admission_no : student.admission_no,
    intake: first ? (first.from_intake || (anyIntakeRecorded ? null : student.intake)) : student.intake,
    year: first ? (first.from_year ?? (anyIntakeRecorded ? null : student.year)) : student.year,
    course: first ? (first.from_course_name || student.course?.name || null) : (student.course?.name || null),
    started_at: first?.from_started_at || student.created_at,
    kind: 'ADMISSION',
    notes: null,
    term: null,
    fee_clearance: null,
    recorded_by: null,
  });

  for (const e of entries) {
    stages.push({
      level: e.to_level,
      admission_no: e.new_admission_no || e.old_admission_no,
      intake: e.to_intake || null,
      year: e.to_year ?? null,
      course: e.to_course_name || student.course?.name || null,
      started_at: startOf(e),
      kind: e.kind || 'PROMOTION',
      notes: e.notes || null,
      term: e.term ? `${e.term.name} (${e.term.academic_year})` : null,
      fee_clearance: e.fee_clearance,
      recorded_by: e.promoter?.email || null,
    });
  }

  return stages.map((st, i) => {
    const next = stages[i + 1];
    const isCurrent = !next;
    return {
      ...st,
      ended_at: next ? next.started_at : null,
      is_current: isCurrent,
      // earlier stages were completed; the latest shows the student's present status
      status: isCurrent ? student.status : 'COMPLETED',
    };
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// FIND EXISTING STUDENTS FOR AN APPLICANT
// Used when approving an application, so a returning student is continued, not duplicated.
// ─────────────────────────────────────────────────────────────────────────────
const matchSelect = {
  id: true, admission_no: true, level: true, intake: true, year: true, status: true, application_id: true,
  user: { select: { email: true } },
  application: { select: { surname: true, other_names: true, id_number: true, date_of_birth: true } },
  course: { select: { name: true } },
  department: { select: { name: true } },
};

const findExistingStudentMatches = async (application) => {
  const found = new Map();
  const add = (student, reason) => {
    if (!student || student.application_id === application.id) return;
    const cur = found.get(student.id) || { student, reasons: [] };
    if (!cur.reasons.includes(reason)) cur.reasons.push(reason);
    found.set(student.id, cur);
  };

  if (application.email) {
    const byEmail = await prisma.student.findFirst({ where: { user: { email: { equals: application.email, mode: 'insensitive' } } }, select: matchSelect });
    add(byEmail, 'Same email address');
  }
  if (application.id_number && application.id_number.trim()) {
    const byId = await prisma.student.findMany({ where: { application: { id_number: application.id_number.trim() } }, select: matchSelect });
    byId.forEach((s) => add(s, 'Same ID number'));
  }
  if (application.surname && application.other_names && application.date_of_birth) {
    const byName = await prisma.student.findMany({
      where: {
        application: {
          surname: { equals: application.surname.trim(), mode: 'insensitive' },
          other_names: { equals: application.other_names.trim(), mode: 'insensitive' },
          date_of_birth: application.date_of_birth,
        },
      },
      select: matchSelect,
    });
    byName.forEach((s) => add(s, 'Same name and date of birth'));
  }

  return [...found.values()].map(({ student, reasons }) => ({
    id: student.id,
    admission_no: student.admission_no,
    name: `${student.application?.surname || ''} ${student.application?.other_names || ''}`.trim(),
    level: student.level,
    intake: student.intake,
    year: student.year,
    status: student.status,
    course: student.course?.name || null,
    department: student.department?.name || null,
    email: student.user?.email || null,
    match_reasons: reasons,
  }));
};

// ─────────────────────────────────────────────────────────────────────────────
// LINK / MERGE TWO RECORDS OF THE SAME PERSON
// An older record (say Level 4) is folded into the newer one (Level 5). Balances, payments, documents
// and history move across; the older admission number, intake and dates become a history stage.
// ─────────────────────────────────────────────────────────────────────────────
const DOCUMENT_FIELDS = [
  'photo_url', 'profile_picture_url', 'id_copy_front_url', 'id_copy_back_url', 'parent_id_copy_front_url',
  'parent_id_copy_back_url', 'medical_report_url', 'kcse_certificate_url', 'birth_certificate_url', 'other_documents_url',
];

const mergeStudents = async (keepId, mergeId, userId) => {
  if (keepId === mergeId) throw Object.assign(new Error('Choose two different student records'), { status: 400 });

  return prisma.$transaction(async (tx) => {
    const include = {
      course: { select: { name: true } },
      student_balances: true,
      documents: true,
      admission_letter: true,
    };
    const [keep, old] = await Promise.all([
      tx.student.findUnique({ where: { id: keepId }, include }),
      tx.student.findUnique({ where: { id: mergeId }, include }),
    ]);
    if (!keep || !old) throw Object.assign(new Error('Student not found'), { status: 404 });

    // Balances: same term in both -> add together, otherwise move across
    for (const ob of old.student_balances) {
      const clash = keep.student_balances.find((kb) => kb.term_id === ob.term_id);
      if (clash) {
        await tx.studentBalance.update({
          where: { id: clash.id },
          data: {
            total_fees: clash.total_fees + ob.total_fees,
            amount_paid: clash.amount_paid + ob.amount_paid,
            balance: clash.balance + ob.balance,
          },
        });
        await tx.studentBalance.delete({ where: { id: ob.id } });
      } else {
        await tx.studentBalance.update({ where: { id: ob.id }, data: { student_id: keep.id } });
      }
    }

    await tx.feeRecord.updateMany({ where: { student_id: old.id }, data: { student_id: keep.id } });
    await tx.studentProgression.updateMany({ where: { student_id: old.id }, data: { student_id: keep.id } });

    // One of each document type per student: the newer record's copy wins
    for (const d of old.documents) {
      if (keep.documents.some((k) => k.document_type === d.document_type)) {
        await tx.studentDocument.delete({ where: { id: d.id } });
      } else {
        await tx.studentDocument.update({ where: { id: d.id }, data: { student_id: keep.id } });
      }
    }
    if (old.admission_letter) {
      if (keep.admission_letter) await tx.admissionLetter.delete({ where: { id: old.admission_letter.id } });
      else await tx.admissionLetter.update({ where: { id: old.admission_letter.id }, data: { student_id: keep.id } });
    }

    // Keep the old application on file, pointing at the continuing record
    await tx.application.updateMany({ where: { OR: [{ id: old.application_id }, { continuing_student_id: old.id }] }, data: { continuing_student_id: keep.id } });

    // Fill any uploaded files the newer record is missing
    const fill = {};
    for (const f of DOCUMENT_FIELDS) if (!keep[f] && old[f]) fill[f] = old[f];
    if (Object.keys(fill).length) await tx.student.update({ where: { id: keep.id }, data: fill });

    await tx.studentProgression.create({
      data: {
        student_id: keep.id,
        from_level: old.level,
        to_level: keep.level,
        term_id: keep.current_term_id || null,
        academic_year: academicYearOf(keep.year),
        promoted_by: userId,
        notes: `Linked earlier record ${old.admission_no} (${old.level}, ${old.intake} ${old.year})`,
        fee_clearance: false,
        old_admission_no: old.admission_no,
        new_admission_no: keep.admission_no,
        from_intake: old.intake,
        from_year: old.year,
        to_intake: keep.intake,
        to_year: keep.year,
        from_course_name: old.course?.name || null,
        to_course_name: keep.course?.name || null,
        from_started_at: old.created_at,
        effective_date: keep.created_at,
        kind: 'LINKED',
      },
    });

    const oldUserId = old.user_id;
    await tx.student.delete({ where: { id: old.id } });
    await tx.refreshToken.deleteMany({ where: { user_id: oldUserId } });
    await tx.user.delete({ where: { id: oldUserId } });

    return { kept: keep.admission_no, merged: old.admission_no };
  }, { timeout: 30000 });
};

module.exports = {
  levelCodeOf,
  academicYearOf,
  progressStudent,
  buildTimeline,
  findExistingStudentMatches,
  mergeStudents,
};

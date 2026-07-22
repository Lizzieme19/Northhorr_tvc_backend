const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Map intake month to term number
 * JANUARY -> Term 1
 * MAY -> Term 2
 * SEPTEMBER -> Term 3
 */
function getIntakeTermNumber(intake) {
  const termMap = {
    'JANUARY': 1,
    'MAY': 2,
    'SEPTEMBER': 3
  };
  return termMap[intake] || 1; // Default to Term 1
}

/**
 * Find or create the appropriate term for a student based on intake and year
 * @param {string} intake - Intake month (JANUARY, MAY, SEPTEMBER)
 * @param {number} year - Academic year
 * @returns {Promise<Term>} The term object
 */
async function getInitialTermForIntake(intake, year) {
  const termNumber = getIntakeTermNumber(intake);
  const academicYear = `${year}/${year + 1}`;
  
  // Try to find existing term
  let term = await prisma.term.findFirst({
    where: {
      academic_year: academicYear,
      name: {
        contains: `Term ${termNumber}`
      },
      is_active: true
    }
  });

  // If term doesn't exist, create it
  if (!term) {
    const startDate = getTermStartDate(termNumber, year);
    const endDate = getTermEndDate(termNumber, year);
    
    term = await prisma.term.create({
      data: {
        name: `Term ${termNumber} ${year}`,
        start_date: startDate,
        end_date: endDate,
        academic_year: academicYear,
        term_cost: 0, // Will be set by admin
        is_active: true
      }
    });
  }

  return term;
}

/**
 * Get start date for a term based on term number and year
 */
function getTermStartDate(termNumber, year) {
  const termDates = {
    1: new Date(year, 0, 1), // January 1st
    2: new Date(year, 4, 1),  // May 1st
    3: new Date(year, 8, 1)   // September 1st
  };
  return termDates[termNumber] || termDates[1];
}

/**
 * Get end date for a term based on term number and year
 */
function getTermEndDate(termNumber, year) {
  const termDates = {
    1: new Date(year, 3, 30),  // April 30th
    2: new Date(year, 7, 31),  // August 31st
    3: new Date(year, 11, 31)  // December 31st
  };
  return termDates[termNumber] || termDates[1];
}

/**
 * Calculate total fees for a student based on their course, level, and term
 * @param {string} courseId - Course ID
 * @param {string} level - Student level
 * @param {string} termId - Term ID
 * @returns {Promise<number>} Total fee amount
 */
async function calculateStudentFees(courseId, level, termId) {
  // Get all applicable fee types
  const feeTypes = await prisma.feeType.findMany({
    where: {
      is_active: true,
      is_disabled: false,
      OR: [
        { applies_to: 'ALL' },
        { applies_to: 'SPECIFIC_COURSE', course_id: courseId },
        { applies_to: 'SPECIFIC_LEVEL', level: level }
      ]
    }
  });

  // Calculate total
  let totalFees = 0;
  for (const feeType of feeTypes) {
    // For term-based fees, use term cost if set, otherwise use fee type amount
    if (feeType.term_based) {
      const term = await prisma.term.findUnique({
        where: { id: termId }
      });
      if (term && term.term_cost > 0) {
        totalFees += term.term_cost;
      } else {
        totalFees += feeType.amount;
      }
    } else {
      // One-time fees (admission, student ID, etc.)
      totalFees += feeType.amount;
    }
  }

  return totalFees;
}

/**
 * Create or update StudentBalance for a term
 * @param {string} studentId - Student ID
 * @param {string} termId - Term ID
 * @param {string} level - Student level at time of enrollment
 * @returns {Promise<StudentBalance>} The student balance record
 */
async function createStudentBalance(studentId, termId, level) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    include: { course: true }
  });

  if (!student) {
    throw new Error('Student not found');
  }

  // Calculate fees
  const totalFees = await calculateStudentFees(student.course_id, level, termId);

  // Check if balance already exists
  let balance = await prisma.studentBalance.findUnique({
    where: {
      student_id_term_id: {
        student_id: studentId,
        term_id: termId
      }
    }
  });

  if (balance) {
    // Update existing balance
    balance = await prisma.studentBalance.update({
      where: { id: balance.id },
      data: {
        total_fees: totalFees,
        balance: totalFees - balance.amount_paid
      }
    });
  } else {
    // Create new balance
    balance = await prisma.studentBalance.create({
      data: {
        student_id: studentId,
        term_id: termId,
        level: level,
        total_fees: totalFees,
        amount_paid: 0,
        balance: totalFees,
        status: 'PENDING'
      }
    });
  }

  return balance;
}

/**
 * Check if student can enroll in a term
 * @param {string} studentId - Student ID
 * @param {string} termId - Term ID
 * @returns {Promise<{canEnroll: boolean, reason?: string}>}
 */
async function canEnrollInTerm(studentId, termId) {
  // Check if already enrolled
  const existingBalance = await prisma.studentBalance.findUnique({
    where: {
      student_id_term_id: {
        student_id: studentId,
        term_id: termId
      }
    }
  });

  if (existingBalance) {
    return { canEnroll: false, reason: 'Already enrolled in this term' };
  }

  // Check if term is active
  const term = await prisma.term.findUnique({
    where: { id: termId }
  });

  if (!term || !term.is_active) {
    return { canEnroll: false, reason: 'Term is not active' };
  }

  // Check if previous term fees are paid (optional - can be relaxed)
  const previousBalances = await prisma.studentBalance.findMany({
    where: {
      student_id: studentId,
      status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] }
    },
    include: { term: true }
  });

  if (previousBalances.length > 0) {
    const unpaidTerms = previousBalances.map(b => b.term.name).join(', ');
    return { 
      canEnroll: false, 
      reason: `Previous term fees not paid: ${unpaidTerms}` 
    };
  }

  return { canEnroll: true };
}

module.exports = {
  getIntakeTermNumber,
  getInitialTermForIntake,
  calculateStudentFees,
  createStudentBalance,
  canEnrollInTerm
};

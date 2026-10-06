const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Generate admission number in format: DEPT_SHORTCODE/LEVEL/INCREMENTAL_NUMBER/YEAR_SHORT/MONTH_SHORTCODE
 * Example: AGR/L6/001/26/S
 *
 * @param {string} departmentId - Department ID
 * @param {string} level - Student level (e.g., "L3", "L4", "L5")
 * @param {string} intakeMonth - Intake month (JANUARY, MAY, SEPTEMBER)
 * @param {number} year - Admission year
 * @returns {Promise<string>} Generated admission number
 */
async function generateAdmissionNumber(courseId, level, intakeMonth, year) {
  try {
    // Get course shortcode
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { shortcode: true }
    });

    if (!course || !course.shortcode) {
      throw new Error('Course shortcode not found');
    }

    // Get month shortcode from department's intake_months
    const monthShortcodeMap = {
      'JANUARY': 'J',
      'MAY': 'M',
      'SEPTEMBER': 'S'
    };

    const monthShortcode = monthShortcodeMap[intakeMonth];
    if (!monthShortcode) {
      throw new Error(`Invalid intake month: ${intakeMonth}`);
    }

    // Convert year to 2-digit format
    const yearShort = year.toString().slice(-2);

    // Get all admission numbers for this course and year to find the true max sequence
    const students = await prisma.student.findMany({
      where: {
        course_id: courseId,
        year: year
      },
      select: {
        admission_no: true
      }
    });

    // Extract the maximum incremental number from the existing admission numbers
    let maxNumber = 0;
    for (const student of students) {
      if (student.admission_no) {
        const parts = student.admission_no.split('/');
        if (parts.length >= 5) {
          // Format is DEPT/LEVEL/NUM/YEAR_SHORT/MONTH, so number is at index 2
          const num = parseInt(parts[2], 10);
          if (!isNaN(num) && num > maxNumber) {
            maxNumber = num;
          }
        }
      }
    }
    const nextNumber = maxNumber + 1;

    // Format the number with leading zeros (3 digits)
    const formattedNumber = nextNumber.toString().padStart(3, '0');

    // Construct admission number: COURSE/LEVEL/NUM/YEAR_SHORT/MONTH
    const admissionNo = `${course.shortcode}/${level}/${formattedNumber}/${yearShort}/${monthShortcode}`;

    return admissionNo;
  } catch (error) {
    console.error('Error generating admission number:', error);
    throw error;
  }
}

/**
 * Get month shortcode from intake enum
 * @param {string} intake - Intake enum value (JANUARY, MAY, SEPTEMBER)
 * @returns {string} Month shortcode (J, M, S)
 */
function getMonthShortcode(intake) {
  const monthShortcodeMap = {
    'JANUARY': 'J',
    'MAY': 'M',
    'SEPTEMBER': 'S'
  };
  return monthShortcodeMap[intake] || 'M'; // Default to May
}

/**
 * Validate admission number format
 * @param {string} admissionNo - Admission number to validate
 * @returns {boolean} True if valid format
 */
function validateAdmissionNumberFormat(admissionNo) {
  // Format: COURSE/LEVEL/NUM/YEAR_SHORT/MONTH
  const regex = /^[A-Z0-9-]{2,10}\/L\d\/\d{3}\/\d{2}\/[JMS]$/;
  return regex.test(admissionNo);
}

/**
 * Parse admission number to extract components
 * @param {string} admissionNo - Admission number to parse
 * @returns {object} Parsed components
 */
function parseAdmissionNumber(admissionNo) {
  if (!validateAdmissionNumberFormat(admissionNo)) {
    throw new Error('Invalid admission number format');
  }

  const parts = admissionNo.split('/');
  return {
    courseShortcode: parts[0],
    level: parts[1],
    number: parseInt(parts[2], 10),
    yearShort: parseInt(parts[3], 10),
    monthShortcode: parts[4]
  };
}

module.exports = {
  generateAdmissionNumber,
  getMonthShortcode,
  validateAdmissionNumberFormat,
  parseAdmissionNumber
};

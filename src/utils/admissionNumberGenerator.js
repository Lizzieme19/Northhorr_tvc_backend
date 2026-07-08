const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Generate admission number in format: DEPT_SHORTCODE/INCREMENTAL_NUMBER/LEVEL/MONTH_SHORTCODE/YEAR
 * Example: ECS/001/L3/M/2026
 * 
 * @param {string} departmentId - Department ID
 * @param {string} level - Student level (e.g., "L3", "L4", "L5")
 * @param {string} intakeMonth - Intake month (JANUARY, MAY, SEPTEMBER)
 * @param {number} year - Admission year
 * @returns {Promise<string>} Generated admission number
 */
async function generateAdmissionNumber(departmentId, level, intakeMonth, year) {
  try {
    // Get department shortcode
    const department = await prisma.department.findUnique({
      where: { id: departmentId },
      select: { shortcode: true }
    });

    if (!department || !department.shortcode) {
      throw new Error('Department shortcode not found');
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

    // Get the last admission number for this department and year
    const lastStudent = await prisma.student.findFirst({
      where: {
        department_id: departmentId,
        year: year
      },
      orderBy: {
        admission_no: 'desc'
      },
      select: {
        admission_no: true
      }
    });

    // Extract the incremental number from the last admission number
    let nextNumber = 1;
    if (lastStudent && lastStudent.admission_no) {
      const parts = lastStudent.admission_no.split('/');
      if (parts.length >= 2) {
        const lastNumber = parseInt(parts[1], 10);
        if (!isNaN(lastNumber)) {
          nextNumber = lastNumber + 1;
        }
      }
    }

    // Format the number with leading zeros (3 digits)
    const formattedNumber = nextNumber.toString().padStart(3, '0');

    // Construct admission number: DEPT/NUM/LEVEL/MONTH/YEAR
    const admissionNo = `${department.shortcode}/${formattedNumber}/${level}/${monthShortcode}/${year}`;

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
  // Format: DEPT/NUM/LEVEL/MONTH/YEAR
  const regex = /^[A-Z]{2,4}\/\d{3}\/L\d\/[JMS]\/\d{4}$/;
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
    departmentShortcode: parts[0],
    number: parseInt(parts[1], 10),
    level: parts[2],
    monthShortcode: parts[3],
    year: parseInt(parts[4], 10)
  };
}

module.exports = {
  generateAdmissionNumber,
  getMonthShortcode,
  validateAdmissionNumberFormat,
  parseAdmissionNumber
};

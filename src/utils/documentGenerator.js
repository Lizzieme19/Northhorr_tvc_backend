const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const fs = require('fs');
const path = require('path');

/**
 * Load a DOCX template
 */
function loadTemplate(templateName) {
  const templatePath = path.join(__dirname, '../../public/templates', templateName);
  const content = fs.readFileSync(templatePath, 'binary');
  return content;
}

/**
 * Fill DOCX template with data
 */
function fillTemplate(templateContent, data) {
  const zip = new PizZip(templateContent);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  doc.render(data);
  return doc.getZip().generate({
    type: 'nodebuffer',
    compression: 'DEFLATE',
  });
}

/**
 * Generate Letter of Acceptance
 */
function generateLetterOfAcceptance(studentData) {
  const template = loadTemplate('letter_of_acceptance.docx');
  
  const data = {
    candidate_name: `${studentData.first_name} ${studentData.last_name}`,
    admission_no: studentData.admission_no || 'N/A',
    id_birth_cert_no: studentData.id_number || studentData.birth_certificate_no || 'N/A',
    department_name: studentData.department?.name || 'N/A',
    course_name: studentData.course?.name || 'N/A',
    current_date: new Date().toLocaleDateString(),
  };

  return fillTemplate(template, data);
}

/**
 * Generate Admission for Training document
 */
function generateAdmissionForTraining(studentData) {
  const template = loadTemplate('admission_for_training.docx');
  
  const data = {
    student_name: `${studentData.first_name} ${studentData.last_name}`,
    admission_no: studentData.admission_no || 'N/A',
    course_name: studentData.course?.name || 'N/A',
    department_name: studentData.department?.name || 'N/A',
    start_date: studentData.intake_date ? new Date(studentData.intake_date).toLocaleDateString() : 'N/A',
    duration: studentData.course?.duration || 'N/A',
    current_date: new Date().toLocaleDateString(),
  };

  return fillTemplate(template, data);
}

/**
 * Generate Fee Structure document
 */
function generateFeeStructure(studentData) {
  const template = loadTemplate('fee_structure.docx');
  
  const data = {
    student_name: `${studentData.first_name} ${studentData.last_name}`,
    admission_no: studentData.admission_no || 'N/A',
    course_name: studentData.course?.name || 'N/A',
    department_name: studentData.department?.name || 'N/A',
    academic_year: studentData.academic_year || 'N/A',
    semester: studentData.semester || 'N/A',
    total_fees: studentData.total_fees || 'N/A',
    current_date: new Date().toLocaleDateString(),
  };

  return fillTemplate(template, data);
}

/**
 * Generate Student Personal Information document
 */
function generateStudentPersonalInfo(studentData) {
  const template = loadTemplate('student_personal_information.docx');
  
  const data = {
    student_name: `${studentData.first_name} ${studentData.last_name}`,
    admission_no: studentData.admission_no || 'N/A',
    date_of_birth: studentData.date_of_birth ? new Date(studentData.date_of_birth).toLocaleDateString() : 'N/A',
    gender: studentData.gender || 'N/A',
    phone: studentData.phone || 'N/A',
    email: studentData.email || 'N/A',
    address: studentData.address || 'N/A',
    county: studentData.county || 'N/A',
    sub_county: studentData.sub_county || 'N/A',
    course_name: studentData.course?.name || 'N/A',
    department_name: studentData.department?.name || 'N/A',
    guardian_name: studentData.guardian_name || 'N/A',
    guardian_phone: studentData.guardian_phone || 'N/A',
    guardian_relationship: studentData.guardian_relationship || 'N/A',
    current_date: new Date().toLocaleDateString(),
  };

  return fillTemplate(template, data);
}

module.exports = {
  generateLetterOfAcceptance,
  generateAdmissionForTraining,
  generateFeeStructure,
  generateStudentPersonalInfo,
};

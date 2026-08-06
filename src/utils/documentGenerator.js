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
    ref_no: studentData.ref_no || 'NHTVC/ADM',
    student_name: `${studentData.first_name} ${studentData.last_name}`,
    student_address: studentData.address || 'N/A',
    admission_no: studentData.admission_no || 'N/A',
    course_name: studentData.course?.name || 'N/A',
    department_name: studentData.department?.name || 'N/A',
    reporting_date: studentData.reporting_date ? new Date(studentData.reporting_date).toLocaleDateString() : 'N/A',
    reporting_deadline: studentData.reporting_deadline ? new Date(studentData.reporting_deadline).toLocaleDateString() : 'N/A',
    duration: studentData.course?.duration || 'N/A',
    current_date: new Date().toLocaleDateString(),
  };

  return fillTemplate(template, data);
}

/**
 * Generate Fee Structure document (minimal placeholders - just basic info)
 */
function generateFeeStructure(studentData) {
  const template = loadTemplate('fee_structure.docx');
  
  const data = {
    student_name: `${studentData.first_name} ${studentData.last_name}`,
    admission_no: studentData.admission_no || 'N/A',
    current_date: new Date().toLocaleDateString(),
  };

  return fillTemplate(template, data);
}

/**
 * Generate Student Personal Information document (minimal placeholders - just basic info)
 */
function generateStudentPersonalInfo(studentData) {
  const template = loadTemplate('student_personal_information.docx');
  
  const data = {
    student_name: `${studentData.first_name} ${studentData.last_name}`,
    admission_no: studentData.admission_no || 'N/A',
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

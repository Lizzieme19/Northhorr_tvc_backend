// EmailJS REST API email service
// Required environment variables:
// EMAILJS_SERVICE_ID
// EMAILJS_PUBLIC_KEY
// EMAILJS_PRIVATE_KEY
// EMAILJS_ADMISSION_TEMPLATE_ID   - template for admission confirmations
// EMAILJS_CONTACT_TEMPLATE_ID     - template for contact/notification emails

/**
 * Core EmailJS sender — calls the EmailJS REST API
 * Works from Node.js (server-side) when "Allow API for non-browser apps" is enabled.
 */
const sendEmailJS = async (template_id, template_params) => {
  try {
    const service_id   = process.env.EMAILJS_SERVICE_ID;
    const public_key   = process.env.EMAILJS_PUBLIC_KEY;
    const private_key  = process.env.EMAILJS_PRIVATE_KEY;

    if (!service_id || !template_id || !public_key || !private_key) {
      console.warn('EmailJS credentials missing. Skipping email send.');
      return false;
    }

    const payload = {
      service_id,
      template_id,
      user_id:     public_key,
      accessToken: private_key,
      template_params,
    };

    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('EmailJS API error:', errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('EmailJS fetch error:', error);
    return false;
  }
};

/**
 * Send admission confirmation email to a newly enrolled student.
 * Uses: EMAILJS_ADMISSION_TEMPLATE_ID
 *
 * Required template variables in EmailJS:
 *   {{to_email}}, {{student_name}}, {{admission_no}}, {{course}},
 *   {{department}}, {{level}}, {{intake}}, {{temp_password}}
 */
const sendAdmissionConfirmation = async (to, studentData, tempPassword) => {
  const templateParams = {
    to_email:     to,
    student_name: studentData.student_name
      || (studentData.application
        ? `${studentData.application.surname} ${studentData.application.other_names}`
        : 'Student'),
    admission_no:  studentData.admission_no,
    course:        studentData.course       || 'N/A',
    department:    studentData.department   || 'N/A',
    level:         studentData.level,
    intake:        `${studentData.intake} ${studentData.year}`,
    temp_password: tempPassword,
  };

  const template_id = process.env.EMAILJS_ADMISSION_TEMPLATE_ID;
  const success = await sendEmailJS(template_id, templateParams);
  if (success) {
    console.log(`Admission confirmation email sent to ${to}`);
  } else {
    console.warn(`Failed to send admission confirmation email to ${to}`);
  }
  return success;
};

/**
 * Send a generic notification / contact-form email.
 * Uses: EMAILJS_CONTACT_TEMPLATE_ID
 *
 * Required template variables in EmailJS:
 *   {{to_email}}, {{subject}}, {{message_html}}
 *
 * @param {string} to          - Recipient email address
 * @param {string} subject     - Email subject
 * @param {string} messageHtml - HTML body content
 */
const sendNotification = async (to, subject, messageHtml) => {
  if (!to) {
    console.warn('sendNotification: no recipient email provided, skipping.');
    return false;
  }

  const template_id = process.env.EMAILJS_CONTACT_TEMPLATE_ID;
  if (!template_id) {
    console.warn(
      'EMAILJS_CONTACT_TEMPLATE_ID is not set. ' +
      'Create a contact template in EmailJS and add this env var.'
    );
    return false;
  }

  const templateParams = {
    to_email:     to,
    subject:      subject,
    message_html: messageHtml,
  };

  const success = await sendEmailJS(template_id, templateParams);
  if (success) {
    console.log(`Notification email sent to ${to} — "${subject}"`);
  } else {
    console.warn(`Failed to send notification email to ${to} — "${subject}"`);
  }
  return success;
};

module.exports = {
  sendAdmissionConfirmation,
  sendNotification,
};

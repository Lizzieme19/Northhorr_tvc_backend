// Use native fetch to call EmailJS REST API
// Ensure you have these environment variables set:
// EMAILJS_SERVICE_ID
// EMAILJS_TEMPLATE_ID
// EMAILJS_PUBLIC_KEY
// EMAILJS_PRIVATE_KEY

const sendEmailJS = async (template_params) => {
  try {
    const service_id = process.env.EMAILJS_SERVICE_ID;
    const template_id = process.env.EMAILJS_ADMISSION_TEMPLATE_ID;
    const public_key = process.env.EMAILJS_PUBLIC_KEY;
    const private_key = process.env.EMAILJS_PRIVATE_KEY;

    if (!service_id || !template_id || !public_key || !private_key) {
      console.warn('EmailJS credentials missing. Emails will not be sent.');
      return false;
    }

    const payload = {
      service_id,
      template_id,
      user_id: public_key,
      accessToken: private_key,
      template_params
    };

    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Error from EmailJS API:', errorText);
      return false;
    }

    return true;
  } catch (error) {
    console.error('EmailJS fetch error:', error);
    return false;
  }
};

/**
 * Send admission confirmation email
 * @param {string} to - Recipient email
 * @param {object} studentData - Student information
 * @param {string} tempPassword - Temporary password
 */
const sendAdmissionConfirmation = async (to, studentData, tempPassword) => {
  const templateParams = {
    to_email: to,
    student_name: studentData.application ? `${studentData.application.surname} ${studentData.application.other_names}` : 'Student',
    admission_no: studentData.admission_no,
    course: studentData.course || 'N/A',
    department: studentData.department || 'N/A',
    level: studentData.level,
    intake: `${studentData.intake} ${studentData.year}`,
    temp_password: tempPassword
  };

  const success = await sendEmailJS(templateParams);
  if (success) {
    console.log(`Admission confirmation email sent to ${to}`);
  }
  return success;
};

module.exports = {
  sendAdmissionConfirmation
};

const nodemailer = require('nodemailer');

// Create transporter using environment variables
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT || 587,
    secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
};

/**
 * Send admission confirmation email
 * @param {string} to - Recipient email
 * @param {object} studentData - Student information
 * @param {string} tempPassword - Temporary password
 */
const sendAdmissionConfirmation = async (to, studentData, tempPassword) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"North Horr TVC" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to,
      subject: 'Admission Confirmation - North Horr Technical & Vocational College',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #1e3a8a; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9fafb; }
            .footer { background: #1e3a8a; color: white; padding: 15px; text-align: center; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #1e3a8a; color: white; text-decoration: none; border-radius: 4px; margin: 10px 0; }
            .info-box { background: #dbeafe; padding: 15px; border-left: 4px solid #1e3a8a; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>NORTH HORR TECHNICAL & VOCATIONAL COLLEGE</h1>
              <p>Student Admission System</p>
            </div>
            <div class="content">
              <h2>Congratulations on Your Admission!</h2>
              <p>Dear Student,</p>
              <p>We are pleased to inform you that your application has been approved and you have been admitted to North Horr Technical & Vocational College.</p>
              
              <div class="info-box">
                <h3>Your Admission Details:</h3>
                <p><strong>Admission Number:</strong> ${studentData.admission_no}</p>
                <p><strong>Course:</strong> ${studentData.course}</p>
                <p><strong>Department:</strong> ${studentData.department}</p>
                <p><strong>Level:</strong> ${studentData.level}</p>
                <p><strong>Intake:</strong> ${studentData.intake} ${studentData.year}</p>
              </div>
              
              <div class="info-box">
                <h3>Your Login Credentials:</h3>
                <p><strong>Email:</strong> ${to}</p>
                <p><strong>Temporary Password:</strong> <code>${tempPassword}</code></p>
                <p><em>Please change your password immediately after first login.</em></p>
              </div>
              
              <p><strong>Next Steps:</strong></p>
              <ul>
                <li>Log in to the student portal using your credentials</li>
                <li>Change your temporary password</li>
                <li>Complete your profile by uploading your profile picture</li>
                <li>Pay your admission fee to secure your place</li>
              </ul>
              
              <p>If you have any questions, please contact the admissions office.</p>
              
              <p>Best regards,<br>Admissions Office<br>North Horr Technical & Vocational College</p>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply directly.</p>
              <p>&copy; ${new Date().getFullYear()} North Horr Technical & Vocational College. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Admission confirmation email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('Error sending admission confirmation email:', error);
    return false;
  }
};

/**
 * Send fee payment reminder email
 * @param {string} to - Recipient email
 * @param {object} studentData - Student information
 * @param {string} feeType - Type of fee (ADMISSION, KUCCPS, STUDENT_ID)
 * @param {number} amount - Fee amount
 */
const sendFeeReminder = async (to, studentData, feeType, amount) => {
  try {
    const transporter = createTransporter();
    
    const feeTypeLabels = {
      ADMISSION: 'Admission Fee',
      KUCCPS: 'KUCCPS Fee',
      STUDENT_ID: 'Student ID Fee',
    };
    
    const mailOptions = {
      from: `"North Horr TVC" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to,
      subject: `Fee Payment Reminder - ${feeTypeLabels[feeType]}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #1e3a8a; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9fafb; }
            .footer { background: #1e3a8a; color: white; padding: 15px; text-align: center; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #1e3a8a; color: white; text-decoration: none; border-radius: 4px; margin: 10px 0; }
            .info-box { background: #fef3c7; padding: 15px; border-left: 4px solid #f59e0b; margin: 15px 0; }
            .urgent { background: #fee2e2; padding: 15px; border-left: 4px solid #ef4444; margin: 15px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>NORTH HORR TECHNICAL & VOCATIONAL COLLEGE</h1>
              <p>Fee Payment Reminder</p>
            </div>
            <div class="content">
              <h2>Fee Payment Reminder</h2>
              <p>Dear Student,</p>
              <p>This is a reminder that you have an outstanding fee payment.</p>
              
              <div class="urgent">
                <h3>Payment Details:</h3>
                <p><strong>Admission Number:</strong> ${studentData.admission_no}</p>
                <p><strong>Fee Type:</strong> ${feeTypeLabels[feeType]}</p>
                <p><strong>Amount:</strong> KES ${amount.toLocaleString()}</p>
              </div>
              
              <p><strong>Payment Methods:</strong></p>
              <ul>
                <li>Bank Transfer (details available at finance office)</li>
                <li>Cash payment at the finance office</li>
                <li>M-Pesa (if available)</li>
              </ul>
              
              <p>Please ensure payment is made as soon as possible to avoid any inconvenience.</p>
              
              <p>If you have already made this payment, please disregard this notice and contact the finance office for confirmation.</p>
              
              <p>Best regards,<br>Finance Office<br>North Horr Technical & Vocational College</p>
            </div>
            <div class="footer">
              <p>This is an automated email. Please do not reply directly.</p>
              <p>&copy; ${new Date().getFullYear()} North Horr Technical & Vocational College. All rights reserved.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Fee reminder email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('Error sending fee reminder email:', error);
    return false;
  }
};

/**
 * Send general notification email
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} htmlContent - HTML content of the email
 */
const sendNotification = async (to, subject, htmlContent) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"North Horr TVC" <${process.env.EMAIL_FROM || process.env.EMAIL_USER}>`,
      to,
      subject,
      html: htmlContent,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Notification email sent to ${to}`);
    return true;
  } catch (error) {
    console.error('Error sending notification email:', error);
    return false;
  }
};

module.exports = {
  sendAdmissionConfirmation,
  sendFeeReminder,
  sendNotification,
};

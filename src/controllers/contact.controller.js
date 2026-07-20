const { sendNotification } = require('../services/emailService');

/**
 * Send contact form email
 */
const sendContactEmail = async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    // Validate required fields
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name, email, subject, and message are required' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid email format' 
      });
    }

    // Create HTML email content
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #1e3a8a; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9fafb; }
          .footer { background: #1e3a8a; color: white; padding: 15px; text-align: center; font-size: 12px; }
          .info-box { background: #dbeafe; padding: 15px; border-left: 4px solid #1e3a8a; margin: 15px 0; }
          .message-box { background: #f3f4f6; padding: 15px; border-radius: 4px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>NORTH HORR TECHNICAL & VOCATIONAL COLLEGE</h1>
            <p>New Contact Form Submission</p>
          </div>
          <div class="content">
            <h2>Contact Form Message</h2>
            <p>You have received a new message through the contact form.</p>
            
            <div class="info-box">
              <h3>Contact Information:</h3>
              <p><strong>Name:</strong> ${name}</p>
              <p><strong>Email:</strong> ${email}</p>
              ${phone ? `<p><strong>Phone:</strong> ${phone}</p>` : ''}
              <p><strong>Subject:</strong> ${subject}</p>
            </div>
            
            <div class="message-box">
              <h3>Message:</h3>
              <p>${message.replace(/\n/g, '<br>')}</p>
            </div>
            
            <p><em>This message was sent from the North Horr TVC website contact form.</em></p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} North Horr Technical & Vocational College. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    // Send email to the college email (configured in EMAIL_FROM)
    const emailSent = await sendNotification(
      process.env.EMAIL_FROM || process.env.EMAIL_USER,
      `Contact Form: ${subject} - ${name}`,
      htmlContent
    );

    if (emailSent) {
      return res.status(200).json({ 
        success: true, 
        message: 'Message sent successfully' 
      });
    } else {
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to send email. Please try again later.' 
      });
    }
  } catch (error) {
    console.error('Error sending contact email:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'An error occurred while sending the message' 
    });
  }
};

module.exports = {
  sendContactEmail,
};

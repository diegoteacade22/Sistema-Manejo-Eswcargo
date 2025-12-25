
import nodemailer from 'nodemailer';

export async function sendEmail(to: string, subject: string, html: string) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
        console.error('Missing SMTP credentials');
        return { success: false, message: 'Faltan credenciales SMTP en el servidor.' };
    }

    try {
        const transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: parseInt(SMTP_PORT || '465'),
            secure: parseInt(SMTP_PORT || '465') === 465, // true for 465, false for other ports
            auth: {
                user: SMTP_USER,
                pass: SMTP_PASS,
            },
        });

        await transporter.verify();

        const info = await transporter.sendMail({
            from: `ESWCARGO <${SMTP_USER}>`,
            to,
            subject,
            html,
        });

        console.log('Message sent: %s', info.messageId);
        return { success: true };
    } catch (error: any) {
        console.error('Error sending email:', error);
        return { success: false, message: error.message };
    }
}

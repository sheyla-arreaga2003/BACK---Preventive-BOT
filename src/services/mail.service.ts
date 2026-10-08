import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,

    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
    }
});

interface SendMailParams {
    to: string;
    subject: string;
    html: string;
}

export async function sendMail({
    to,
    subject,
    html
}: SendMailParams): Promise<void> {

    await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to,
        subject,
        html
    });
}

export async function verifyMailConnection(): Promise<void> {
    await transporter.verify();
    console.log('✅ Servidor de correo conectado');
}
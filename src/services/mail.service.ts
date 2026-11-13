import nodemailer from "nodemailer";
import "../config/env.js";

export interface SendMailParams {
  to: string;
  subject: string;
  html: string;
}

interface GmailConfiguration {
  host: string;
  port: number;
  user: string;
  from: string;
  password: string;
}

interface MailTransport {
  sendMail(options: Record<string, unknown>): Promise<unknown>;
  verify(): Promise<unknown>;
}
type TransportFactory = (options: Record<string, unknown>) => MailTransport;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta configurar ${name} para el correo de Gmail`);
  return value;
}

export function getGmailConfiguration(): GmailConfiguration {
  return {
    host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    user: required("SMTP_USER"),
    from: required("MAIL_FROM"),
    password: required("SMTP_PASSWORD").replace(/\s+/g, ""),
  };
}

export function createGmailTransport(
  configuration: GmailConfiguration,
  factory: TransportFactory = nodemailer.createTransport as unknown as TransportFactory,
): MailTransport {
  return factory({
    host: configuration.host,
    port: configuration.port,
    secure: false,
    requireTLS: true,
    tls: { minVersion: "TLSv1.2" },
    auth: {
      user: configuration.user,
      pass: configuration.password,
    },
  });
}

let transporter: MailTransport | null = null;
function getTransporter(): MailTransport {
  transporter ??= createGmailTransport(getGmailConfiguration());
  return transporter;
}

export async function sendMail({ to, subject, html }: SendMailParams): Promise<void> {
  const configuration = getGmailConfiguration();
  await getTransporter().sendMail({ from: configuration.from, to, subject, html });
}

export async function verifyMailConnection(): Promise<void> {
  await getTransporter().verify();
  console.log("Servidor de correo Gmail conectado");
}

export function getMailConfigurationSummary(): { provider: string; host: string; port: number; user: string; from: string; authentication: string } {
  const configuration = getGmailConfiguration();
  return {
    provider: "Gmail",
    host: configuration.host,
    port: configuration.port,
    user: configuration.user,
    from: configuration.from,
    authentication: "Contraseña de aplicación",
  };
}

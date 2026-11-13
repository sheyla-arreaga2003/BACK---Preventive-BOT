import { ReminderType, ReminderState } from '../enums/reminder.enum.js';
import type { ReminderTemplateParams } from '../interfaces/reminder.interface.js';
import { addReminder, getPendingReminders, getMailDataByMaintenanceId, markReminderFailed, updateReminderState, updateReminderSubject } from './database.service.js';

export function getReminderSubject(type: ReminderType): string {
    switch (type) {
        case ReminderType.SERVICE_CREATED:
            return 'Tu servicio ha sido agendado | Mototec';
        case ReminderType.SERVICE_TOMORROW:
            return 'Tu servicio es mañana | Mototec';
        case ReminderType.SERVICE_TODAY:
            return '¡Tu servicio es hoy! | Mototec';
        case ReminderType.SERVICE_MISSED:
            return '¿Necesitas reagendar tu servicio? | Mototec';
        case ReminderType.CUSTOM:
            throw new Error('Los recordatorios personalizados utilizan el asunto redactado por el administrador');
    }
}

export function withActualReminderSubject<T extends { REType: ReminderType; RETitle: string }>(data: T): T {
    if (data.REType === ReminderType.CUSTOM) return data;
    return { ...data, RETitle: getReminderSubject(data.REType) };
}

export function getReminderContent(data: ReminderTemplateParams) {

    switch (data.type) {

        case ReminderType.SERVICE_CREATED:

            return {
                subject: getReminderSubject(data.type),

                badge: '✓ Servicio agendado',

                badgeBackground: '#e9f8f6',
                badgeColor: '#087f72',

                title: '¡Tu servicio ha sido agendado!',

                message:
                    `Tu cita de mantenimiento ha sido agendada ` +
                    `exitosamente. Te esperamos en la fecha y hora indicada.`,

                button: 'Ver mi servicio',

                noticeBackground: '#f4f7fa',

                notice:
                    'Si necesitas realizar algún cambio, puedes comunicarte con nosotros.'
            };


        case ReminderType.SERVICE_TOMORROW:

            return {
                subject: getReminderSubject(data.type),

                badge: '◷ Servicio mañana',

                badgeBackground: '#fff5e8',
                badgeColor: '#dd7500',

                title: 'Tu servicio es mañana',

                message:
                    `Te recordamos que tienes un servicio de mantenimiento ` +
                    `programado para mañana. ¡Te esperamos!`,

                button: 'Ver mi servicio',

                noticeBackground: '#fff7eb',

                notice:
                    'Si necesitas cambiar la fecha, comunícate con nosotros con anticipación.'
            };


        case ReminderType.SERVICE_TODAY:

            return {
                subject: getReminderSubject(data.type),

                badge: '● Servicio para hoy',

                badgeBackground: '#ffebee',
                badgeColor: '#e51b2b',

                title: '¡Tu servicio es hoy!',

                message:
                    `Te recordamos que hoy tienes tu cita de mantenimiento. ` +
                    `¡Nos vemos pronto en nuestra agencia!`,

                button: 'Ver mi servicio',

                noticeBackground: '#fff0f1',

                notice:
                    'Te recomendamos presentarte unos minutos antes de tu horario.'
            };


        case ReminderType.SERVICE_MISSED:

            return {
                subject: getReminderSubject(data.type),

                badge: 'Servicio pendiente',

                badgeBackground: '#eef1f4',
                badgeColor: '#344054',

                title: '¿Necesitas reagendar tu servicio?',

                message:
                    `Notamos que tenías un servicio programado para ` +
                    `${data.date} y no registramos tu asistencia.`,

                button: 'Reagendar servicio',

                noticeBackground: '#eff6ff',

                notice:
                    'Si ya realizaste el servicio, puedes ignorar este mensaje.'
            };
        case ReminderType.CUSTOM:
            throw new Error('Los recordatorios personalizados no utilizan una plantilla automática');
    }
}

export async function generateReminder(data: any) {
    const reminderData = withActualReminderSubject(data);
    const reminderId = await addReminder(reminderData);
    return reminderId;
}

export async function processPendingReminders() {

    const reminders: any = await getPendingReminders();

    for (const reminder of reminders) {

        try {

            if (reminder.REType === ReminderType.CUSTOM) {
                await sendCustomReminderEmail({
                    to: reminder.RERecipient,
                    subject: reminder.RETitle,
                    message: reminder.REDescription,
                });
            } else {
                const mailData = await getMailDataByMaintenanceId(reminder.MAMaintenance);
                if (!mailData[0]) throw new Error('No se encontraron datos del mantenimiento');
                const reminderType = reminder.REType as ReminderType;
                await updateReminderSubject(reminder.REIdReminder, getReminderSubject(reminderType));
                await sendReminderEmail(mailData[0], reminderType);
            }

            await updateReminderState(reminder.REIdReminder, ReminderState.SENT);

        } catch (error) {

            console.error(
                `Error enviando reminder ${reminder.REIdReminder}`,
                error
            );
            await markReminderFailed(reminder.REIdReminder, error).catch(() => undefined);
        }
    }
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>'"]/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character] ?? character);
}

export async function sendCustomReminderEmail(
    data: { to: string; subject: string; message: string },
    sender: typeof sendMail = sendMail,
): Promise<void> {
    const safeMessage = escapeHtml(data.message).replace(/\r?\n/g, '<br>');
    await sender({
        to: data.to,
        subject: data.subject,
        html: `<div style="font-family:Arial,sans-serif;color:#172033;line-height:1.6;max-width:640px;margin:auto">
          <h1 style="color:#e30613">MOTOTEC</h1><hr style="border:0;border-top:2px solid #e30613">
          <h2>${escapeHtml(data.subject)}</h2><p>${safeMessage}</p><p><em>Equipo Mototec</em></p>
        </div>`,
    });
}

export async function sendReminderEmail(
    data: any,
    type: ReminderType = ReminderType.SERVICE_CREATED,
    sender: typeof sendMail = sendMail,
) {

    const email = generateReminderTemplate({
        type: type,
        clientName: data.ClientName,
        date: data.MADate,
        time: data.MATime,
        motorcycle: data.Model,
        plate: data.Plate,
        agency: data.Agency
    });

    await sender({
        to: data.Mail,
        subject: email.subject,
        html: email.html
    });
}
    

import { sendMail } from '../services/mail.service.js';
import { generateReminderTemplate }
    from '../templates/reminder.template.js';

export async function testEmails() {

    const email1 = generateReminderTemplate({

        type: ReminderType.SERVICE_CREATED,

        clientName: 'Mario',

        date: '10 de octubre de 2026',

        time: '10:00 AM',

        motorcycle: 'Yamaha MT-03',

        plate: 'M123ABC',

        agency: 'Mototec Central'
    });


    await sendMail({
        to: 'maritobraham1@gmail.com',
        subject: email1.subject,
        html: email1.html
    });


    const email2 = generateReminderTemplate({

        type: ReminderType.SERVICE_TODAY,

        clientName: 'Mario',

        date: '10 de octubre de 2026',

        time: '10:00 AM',

        motorcycle: 'Yamaha MT-03',

        plate: 'M123ABC',

        agency: 'Mototec Central'
    });


    await sendMail({
        to: 'maritobraham1@gmail.com',
        subject: email2.subject,
        html: email2.html
    });


    console.log('✅ Correos enviados');
}

// testEmails();

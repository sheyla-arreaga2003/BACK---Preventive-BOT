import { ReminderType, ReminderState } from '../enums/reminder.enum.js';
import type { ReminderTemplateParams } from '../interfaces/reminder.interface.js';
import { addReminder, getPendingReminders, getMailDataByMaintenanceId, updateReminderState } from './database.service.js';

export function getReminderContent(data: ReminderTemplateParams) {

    switch (data.type) {

        case ReminderType.SERVICE_CREATED:

            return {
                subject: 'Tu servicio ha sido agendado | Mototec',

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
                subject: 'Tu servicio es mañana | Mototec',

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
                subject: '¡Tu servicio es hoy! | Mototec',

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
                subject: '¿Necesitas reagendar tu servicio? | Mototec',

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
    }
}

export async function generateReminder(data: any) {
    // Funcion para insertar recordatorios en la base de datos, si es necesario.
    const reminderId = await addReminder(data);
    return reminderId;
}

export async function processPendingReminders() {

    const reminders: any = await getPendingReminders();

    for (const reminder of reminders) {

        try {

            const mailData = await getMailDataByMaintenanceId(reminder.MAMaintenance);

            await sendReminderEmail(mailData[0]);

            await updateReminderState(reminder.REIdReminder, ReminderState.SENT);

        } catch (error) {

            console.error(
                `Error enviando reminder ${reminder.REIdReminder}`,
                error
            );
        }
    }
}

export async function sendReminderEmail(data: any, type: ReminderType = ReminderType.SERVICE_CREATED) {

    const email = generateReminderTemplate({
        type: type,
        clientName: data.ClientName,
        date: data.MADate,
        time: data.MATime,
        motorcycle: data.Model,
        plate: data.Plate,
        agency: data.Agency
    });

    await sendMail({
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
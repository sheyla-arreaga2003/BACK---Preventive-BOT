import { ReminderType } from '../enums/reminder.enum.js';

export interface ReminderTemplateParams {
    type: ReminderType;

    clientName: string;
    date: string;
    time: string;

    motorcycle: string;
    plate: string;
    agency: string;

    description?: string;
}

export interface ReminderTemplateResult {
    subject: string;
    html: string;
}
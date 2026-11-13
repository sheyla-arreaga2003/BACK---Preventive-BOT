-- Ejecutar después de 20261111_personalized_reminders.sql.
-- Registra cuándo se intentó entregar un correo y agrega índices para la bandeja Enviados.
ALTER TABLE REMINDER
  ADD COLUMN REAttemptedAt DATETIME NULL AFTER REDateProgram,
  ADD KEY IX_Reminder_History_State_Date (REState, REAttemptedAt, REIdReminder),
  ADD KEY IX_Reminder_History_Type_Date (REType, REAttemptedAt, REIdReminder),
  ADD KEY IX_Reminder_History_Recipient (RERecipient);

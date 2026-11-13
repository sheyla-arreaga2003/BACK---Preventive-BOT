import assert from "node:assert/strict";
import test from "node:test";
import { getReminderSubject, sendCustomReminderEmail, sendReminderEmail, withActualReminderSubject } from "../src/services/reminder.service.js";
import { ReminderType } from "../src/enums/reminder.enum.js";

test("usa el mismo asunto en la plantilla automática y en el registro del historial", () => {
  const cases = [
    ReminderType.SERVICE_CREATED,
    ReminderType.SERVICE_TOMORROW,
    ReminderType.SERVICE_TODAY,
    ReminderType.SERVICE_MISSED,
  ];

  for (const type of cases) {
    const record = withActualReminderSubject({ REType: type, RETitle: "Texto genérico anterior" });
    assert.equal(record.RETitle, getReminderSubject(type));
  }
});

test("conserva el asunto redactado para un recordatorio personalizado", () => {
  const record = withActualReminderSubject({ REType: ReminderType.CUSTOM, RETitle: "Asunto escrito por administración" });
  assert.equal(record.RETitle, "Asunto escrito por administración");
});

test("el transporte SMTP recibe exactamente el asunto que se guarda en el historial automático", async () => {
  const captured: Array<{ to: string; subject: string; html: string }> = [];
  const type = ReminderType.SERVICE_TODAY;
  const record = withActualReminderSubject({ REType: type, RETitle: "Texto genérico anterior" });

  await sendReminderEmail({
    Mail: "cliente.fixture@example.test",
    ClientName: "Cliente de prueba",
    MADate: "13/11/2026",
    MATime: "10:00",
    Model: "Motocicleta de prueba",
    Plate: "PRUEBA",
    Agency: "Agencia de prueba",
  }, type, async (mail) => { captured.push(mail); });

  assert.equal(captured[0]?.subject, record.RETitle);
});

test("preserva asunto y mensaje y escapa HTML en un recordatorio personalizado", async () => {
  const captured: Array<{ to: string; subject: string; html: string }> = [];
  await sendCustomReminderEmail(
    { to: "cliente.fixture@example.test", subject: "Prueba & revisión", message: "Línea uno\n<script>alert(1)</script>" },
    async (mail) => { captured.push(mail); },
  );
  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.to, "cliente.fixture@example.test");
  assert.equal(captured[0]?.subject, "Prueba & revisión");
  assert.match(captured[0]?.html ?? "", /Línea uno<br>/);
  assert.doesNotMatch(captured[0]?.html ?? "", /<script>/);
});

test("propaga el fallo del transporte de correo", async () => {
  await assert.rejects(
    sendCustomReminderEmail(
      { to: "cliente.fixture@example.test", subject: "Prueba", message: "Mensaje" },
      async () => { throw new Error("transporte simulado no disponible"); },
    ),
    /transporte simulado no disponible/,
  );
});

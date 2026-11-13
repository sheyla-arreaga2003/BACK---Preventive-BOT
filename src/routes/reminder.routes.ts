import { Router, type Router as ExpressRouter } from "express";
import { z } from "zod";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import { createPersonalReminder, getSentReminderCount } from "../services/personal-reminder.service.js";
import { getReminderHistoryDetail, listReminderHistory } from "../services/reminder-history.service.js";

const router: ExpressRouter = Router();
router.use(authMiddleware, authorizeRoles(1));

const requestSchema = z.object({
  customerId: z.number().int().positive(),
  subject: z.string().trim().min(1, "El asunto es obligatorio").max(150),
  message: z.string().trim().min(1, "El mensaje es obligatorio").max(5000),
  delivery: z.enum(["now", "scheduled"]),
  scheduledAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).nullable().optional(),
  requestId: z.string().uuid(),
}).superRefine((value, context) => {
  if (value.delivery === "scheduled" && !value.scheduledAt) {
    context.addIssue({ code: "custom", path: ["scheduledAt"], message: "La fecha y hora son obligatorias" });
  }
});

router.post("/", async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Revisa los datos" });
  try {
    const result = await createPersonalReminder({ ...parsed.data, scheduledAt: parsed.data.scheduledAt ?? null, adminUserId: req.auth!.user.id });
    return res.status(result.duplicate ? 200 : 201).json({
      ...result,
      message: result.status === "SENT" ? "Recordatorio enviado" : result.status === "PENDING" ? "Recordatorio programado" : "El envío falló",
    });
  } catch (error) {
    const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : 500;
    const message = error instanceof Error && status < 500 ? error.message : status === 502 && error instanceof Error ? error.message : "No fue posible guardar el recordatorio";
    return res.status(status).json({ message });
  }
});

router.get("/summary", async (_req, res) => {
  try { return res.json({ sent: await getSentReminderCount() }); }
  catch { return res.status(500).json({ message: "No fue posible obtener el total de recordatorios enviados" }); }
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  search: z.string().trim().max(120).optional(),
  status: z.enum(["PENDING", "SENT", "ERROR"]).optional(),
  type: z.string().trim().min(1).max(50).optional(),
  origin: z.enum(["AUTOMATIC", "MANUAL"]).optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
  message: "El rango de fechas no es válido",
});

router.get("/history", async (req, res) => {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Revisa los filtros" });
  try { return res.json(await listReminderHistory(parsed.data)); }
  catch (error) { console.error("Error consultando historial de correos", error); return res.status(500).json({ message: "No fue posible consultar los mensajes enviados" }); }
});

router.get("/history/:id", async (req, res) => {
  const parsed = z.coerce.number().int().positive().safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ message: "Identificador no válido" });
  try {
    const message = await getReminderHistoryDetail(parsed.data);
    return message ? res.json(message) : res.status(404).json({ message: "Mensaje no encontrado" });
  } catch (error) { console.error("Error consultando detalle de correo", error); return res.status(500).json({ message: "No fue posible consultar el mensaje" }); }
});

export default router;

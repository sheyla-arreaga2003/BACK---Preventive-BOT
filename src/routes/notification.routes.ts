import { Router, type Router as ExpressRouter } from "express";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import {
  getNotificationSettings,
  getNotifications,
  isNotificationType,
  markAllNotificationsRead,
  markNotificationRead,
  updateNotificationSetting,
} from "../services/notification.service.js";

const router: ExpressRouter = Router();
const ADMIN_ROLE_ID = 1;

function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new TypeError("Invalid number");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TypeError("Invalid number");
  return parsed;
}

router.use(authMiddleware, authorizeRoles(ADMIN_ROLE_ID));

router.get("/", async (req, res) => {
  try {
    const page = positiveInteger(req.query.page, 1);
    const pageSize = positiveInteger(req.query.pageSize, 20);
    if (pageSize > 50) return res.status(400).json({ message: "El tamaño de página no es válido" });
    const unreadOnly = req.query.unread === "true";
    return res.json(await getNotifications(page, pageSize, unreadOnly));
  } catch (error: unknown) {
    if (error instanceof TypeError || error instanceof RangeError) return res.status(400).json({ message: "Revisa los parámetros" });
    return res.status(503).json({ message: "No se pudieron cargar las notificaciones" });
  }
});

router.patch("/read-all", async (_req, res) => {
  try {
    return res.json({ updated: await markAllNotificationsRead() });
  } catch {
    return res.status(503).json({ message: "No se pudieron actualizar las notificaciones" });
  }
});

router.patch("/:id/read", async (req, res) => {
  try {
    const id = positiveInteger(req.params.id, 0);
    if (!(await markNotificationRead(id))) return res.status(404).json({ message: "Notificación no encontrada" });
    return res.json({ message: "Notificación marcada como leída" });
  } catch (error: unknown) {
    if (error instanceof TypeError) return res.status(400).json({ message: "Revisa los parámetros" });
    return res.status(503).json({ message: "No se pudo actualizar la notificación" });
  }
});

router.get("/settings", async (_req, res) => {
  try {
    return res.json({ settings: await getNotificationSettings() });
  } catch {
    return res.status(503).json({ message: "No se pudo cargar la configuración" });
  }
});

router.put("/settings/:type", async (req, res) => {
  try {
    const type = req.params.type;
    const body: unknown = req.body;
    if (!isNotificationType(type) || typeof body !== "object" || body === null) {
      return res.status(400).json({ message: "Revisa los datos de la configuración" });
    }
    const { enabled, leadDays } = body as Record<string, unknown>;
    if ((enabled !== undefined && typeof enabled !== "boolean")
      || (leadDays !== undefined && typeof leadDays !== "number")
      || (enabled === undefined && leadDays === undefined)) {
      return res.status(400).json({ message: "Revisa los datos de la configuración" });
    }
    const updated = await updateNotificationSetting(type, {
      ...(enabled !== undefined && { enabled }),
      ...(leadDays !== undefined && { leadDays }),
    });
    if (!updated) return res.status(404).json({ message: "Tipo de aviso no encontrado" });
    return res.json({ settings: await getNotificationSettings() });
  } catch (error: unknown) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return res.status(400).json({ message: "Revisa los datos de la configuración" });
    }
    return res.status(503).json({ message: "No se pudo guardar la configuración" });
  }
});

export default router;

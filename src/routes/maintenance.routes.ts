import { Router, type Router as ExpressRouter } from "express";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import { getMaintenancePageByMotorcycle } from "../services/chatbot-read.service.js";
import {
  getMaintenanceMotorcycleById,
  getMaintenanceMotorcycles,
  getMaintenanceSummary,
  getMaintenanceServices,
  createMaintenance,
} from "../services/maintenance-admin.service.js";

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

router.get("/summary", async (_req, res) => {
  try {
    return res.json(await getMaintenanceSummary());
  } catch {
    return res.status(503).json({ message: "No fue posible consultar la información" });
  }
});

router.get("/services", async (_req, res) => {
  try {
    return res.json({ services: await getMaintenanceServices() });
  } catch {
    return res.status(503).json({ message: "No fue posible consultar la información" });
  }
});

router.post("/", async (req, res) => {
  try {
    if (!req.auth) return res.status(401).json({ message: "Unauthorized" });
    const body: unknown = req.body;
    if (typeof body !== "object" || body === null) return res.status(400).json({ message: "Revisa los datos del mantenimiento" });
    const value = body as Record<string, unknown>;
    const motorcycleId = typeof value.motorcycleId === "number" ? value.motorcycleId : Number.NaN;
    const date = typeof value.date === "string" ? value.date.trim() : "";
    const text = (field: string, max: number): string | null => {
      const raw = value[field];
      if (raw === undefined || raw === null || raw === "") return null;
      if (typeof raw !== "string" || raw.trim().length > max) throw new TypeError("Invalid field");
      return raw.trim();
    };
    if (!Number.isSafeInteger(motorcycleId) || motorcycleId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "Revisa los datos del mantenimiento" });
    }
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      return res.status(400).json({ message: "La fecha no es válida" });
    }
    const rawServices = value.serviceIds ?? [];
    if (!Array.isArray(rawServices) || rawServices.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)) {
      return res.status(400).json({ message: "Revisa los servicios seleccionados" });
    }
    const serviceIds = [...new Set(rawServices.map(Number))];
    const created = await createMaintenance({
      motorcycleId,
      userId: req.auth.user.id,
      date,
      mileage: text("mileage", 50),
      observations: text("observations", 500),
      nextMileage: text("nextMileage", 50),
      nextDate: text("nextDate", 20),
      serviceIds,
    });
    return res.status(201).json({ message: "Mantenimiento registrado correctamente", id: created.id });
  } catch (error: unknown) {
    if (error instanceof TypeError) return res.status(400).json({ message: "Revisa los datos del mantenimiento" });
    return res.status(503).json({ message: "No fue posible registrar el mantenimiento" });
  }
});

router.get("/motorcycles", async (req, res) => {
  try {
    const page = positiveInteger(req.query.page, 1);
    const pageSize = positiveInteger(req.query.pageSize, 10);
    if (pageSize > 20) return res.status(400).json({ message: "El tamaño de página no es válido" });
    const search = typeof req.query.search === "string" ? req.query.search : "";
    if (search.length > 100) return res.status(400).json({ message: "La búsqueda es demasiado larga" });
    return res.json(await getMaintenanceMotorcycles(page, pageSize, search));
  } catch (error: unknown) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return res.status(400).json({ message: "Revisa los parámetros de la consulta" });
    }
    return res.status(503).json({ message: "No fue posible consultar la información" });
  }
});

router.get("/motorcycles/:motorcycleId", async (req, res) => {
  try {
    const motorcycleId = positiveInteger(req.params.motorcycleId, 0);
    const page = positiveInteger(req.query.page, 1);
    const pageSize = positiveInteger(req.query.pageSize, 10);
    if (pageSize > 20) return res.status(400).json({ message: "El tamaño de página no es válido" });
    const motorcycle = await getMaintenanceMotorcycleById(motorcycleId);
    if (!motorcycle) return res.status(404).json({ message: "Motocicleta no encontrada" });
    const history = await getMaintenancePageByMotorcycle(motorcycleId, page, pageSize);
    return res.json({ motorcycle, ...history });
  } catch (error: unknown) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return res.status(400).json({ message: "Revisa los parámetros de la consulta" });
    }
    return res.status(503).json({ message: "No fue posible consultar la información" });
  }
});

export default router;

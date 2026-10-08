import { Router, type Router as ExpressRouter } from "express";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import { getMaintenancePageByMotorcycle } from "../services/chatbot-read.service.js";
import {
  getMaintenanceMotorcycleById,
  getMaintenanceMotorcycles,
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

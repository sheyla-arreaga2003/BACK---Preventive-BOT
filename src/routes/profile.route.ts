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
import { getAdminMaintenanceAppointments } from "../services/maintenance-appointment.service.js";

const router: ExpressRouter = Router();

router.use(authMiddleware);
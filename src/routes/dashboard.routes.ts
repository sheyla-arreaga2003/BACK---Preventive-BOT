import { Router, type Router as ExpressRouter } from "express";
import {
  getAgencies,
  getScheduleByAgencyId,
  addMaintenance,
} from "../services/database.service.js";
import { testEmails, sendReminderEmail, generateReminder } from "../services/reminder.service.js";
import { ReminderType, ReminderState } from "../enums/reminder.enum.js";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";

const router: ExpressRouter = Router();

function isDuplicateMaintenanceSlot(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ER_DUP_ENTRY";
}

router.get("/", async (req, res) => {
  try {
    res.status(200).json({ message: "Dashboard route is working!" });
  } catch (error) {
    console.error("Error in dashboard route:", error);
    res.status(500).json({ message: "Internal server error" });
  }
})

router.get("/agencies", async (req, res) => {
  try {
    const agencies = await getAgencies();
    res.json(agencies);
  } catch (error: unknown) {
    res.status(500).json({
      message: "Error obteniendo las agencias: " + error,
    });
  }
});

router.get("/schedule", async (req, res) => {
  try {
    const { id, date } = req.query;
    const schedule = await getScheduleByAgencyId(Number(id), date as string);
    res.json(schedule);
  } catch (error: unknown) {
    res.status(500).json({
      message: "Error obteniendo el horario: " + error,
    });
  }
});

router.post("/maintenance", authMiddleware, authorizeRoles(1), async (req, res) => {
  try {
    const { idMotorcycle, idAgency, idSchedule, date, miles, observations, serviceIds: rawServiceIds = [] } = req.body;
    const idUser = req.auth?.user.id;

    if (!idMotorcycle) return res.status(400).json({ message: "idMotorcycle is required" });
    if (!idAgency) return res.status(400).json({ message: "idAgency is required" });
    if (!idSchedule) return res.status(400).json({ message: "idSchedule is required" });
    if (!idUser) return res.status(401).json({ message: "Unauthorized" });
    if (!date) return res.status(400).json({ message: "date is required" });
    if (!miles) return res.status(400).json({ message: "miles is required" });
    if (!Array.isArray(rawServiceIds) || rawServiceIds.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)) {
      return res.status(400).json({ message: "Revisa los servicios seleccionados" });
    }
    const serviceIds = [...new Set(rawServiceIds.map(Number))];

    const maintenanceRecord = await addMaintenance(idMotorcycle, idAgency, idSchedule, idUser, date, miles, observations, serviceIds);

    const createdMaintenance = maintenanceRecord[0];
    if (!createdMaintenance) return res.status(500).json({ message: "No fue posible registrar el mantenimiento" });

    const reminderData = [{
      MAMaintenance: createdMaintenance.MAMaintenance,
      REDateProgram: new Date(Date.now()),
      REType: ReminderType.SERVICE_CREATED,
      REState: ReminderState.PENDING,
      REFSend: 'EMAIL',
      RESentAt: '',
      REDescription: 'Recordatorio de mantenimiento creado',
      RETitle: 'Recordatorio de mantenimiento creado',
    },
    {
      MAMaintenance: createdMaintenance.MAMaintenance,
      REDateProgram: new Date(new Date(date).getTime() - 24 * 60 * 60 * 1000),
      REType: ReminderType.SERVICE_TOMORROW,
      REState: ReminderState.PENDING,
      REFSend: 'EMAIL',
      RESentAt: '',
      REDescription: 'Recordatorio de mantenimiento para mañana',
      RETitle: 'Recordatorio de mantenimiento para mañana',
    },
    {
      MAMaintenance: createdMaintenance.MAMaintenance,
      REDateProgram: new Date(date),
      REType: ReminderType.SERVICE_TODAY,
      REState: ReminderState.PENDING,
      REFSend: 'EMAIL',
      RESentAt: '',
      REDescription: 'Recordatorio de mantenimiento para hoy',
      RETitle: 'Recordatorio de mantenimiento para hoy',
    }]

    await generateReminder(reminderData[0]);
    await generateReminder(reminderData[1]);
    await generateReminder(reminderData[2]);

    let notificationSent = true;
    try {
      await sendReminderEmail(createdMaintenance, ReminderType.SERVICE_CREATED);
    } catch {
      notificationSent = false;
      console.warn(
        `No se pudo enviar la notificación del mantenimiento ${createdMaintenance.MAMaintenance}`,
      );
    }

    res.status(201).json({
      message: notificationSent
        ? "Mantenimiento creado exitosamente"
        : "Mantenimiento creado; la notificación por correo quedó pendiente",
      id: createdMaintenance.MAMaintenance,
      notificationSent,
    });
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      return res.status(400).json({ message: "Revisa los servicios seleccionados" });
    }

    if (isDuplicateMaintenanceSlot(error)) {
      return res.status(409).json({
        message: "Ese horario ya está ocupado. Selecciona otro horario.",
      });
    }

    console.error("No se pudo crear el registro de mantenimiento", error);
    res.status(500).json({
      message: "No fue posible registrar el mantenimiento",
    });
  }
});

router.get("/test-email", async (req, res) => {
  try {
    await testEmails();
    res.status(200).json({ message: "Test email sent successfully" });
  } catch (error: unknown) {
    res.status(500).json({
      message: "Error sending test email: " + error,
    });
  }
});

export default router;

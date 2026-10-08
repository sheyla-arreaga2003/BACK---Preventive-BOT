import { Router, type Router as ExpressRouter } from "express";
import {
  getAgencies,
  getScheduleByAgencyId,
  addMaintenance,
} from "../services/database.service.js";
import { testEmails, sendReminderEmail, generateReminder } from "../services/reminder.service.js";
import { ReminderType, ReminderState } from "../enums/reminder.enum.js";

const router: ExpressRouter = Router();

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

router.post("/maintenance", async (req, res) => {
  try {
    const { idMotorcycle, idAgency, idSchedule, idUser, date, miles, observations } = req.body;

    if (!idMotorcycle) return res.status(400).json({ message: "idMotorcycle is required" });
    if (!idAgency) return res.status(400).json({ message: "idAgency is required" });
    if (!idSchedule) return res.status(400).json({ message: "idSchedule is required" });
    if (!idUser) return res.status(400).json({ message: "idUser is required" });
    if (!date) return res.status(400).json({ message: "date is required" });
    if (!miles) return res.status(400).json({ message: "miles is required" });

    const maintenanceRecord = await addMaintenance(idMotorcycle, idAgency, idSchedule, idUser, date, miles, observations);

    if (!maintenanceRecord) return res.status(500).json({ message: "Error creating maintenance record" });

    const reminderData = [{
      MAMaintenance: maintenanceRecord[0].MAMaintenance,
      REDateProgram: new Date(Date.now()),
      REType: ReminderType.SERVICE_CREATED,
      REState: ReminderState.PENDING,
      REFSend: 'EMAIL',
      RESentAt: '',
      REDescription: 'Recordatorio de mantenimiento creado',
      RETitle: 'Recordatorio de mantenimiento creado',
    },
    {
      MAMaintenance: maintenanceRecord[0].MAMaintenance,
      REDateProgram: new Date(new Date(date).getTime() - 24 * 60 * 60 * 1000),
      REType: ReminderType.SERVICE_TOMORROW,
      REState: ReminderState.PENDING,
      REFSend: 'EMAIL',
      RESentAt: '',
      REDescription: 'Recordatorio de mantenimiento para mañana',
      RETitle: 'Recordatorio de mantenimiento para mañana',
    },
    {
      MAMaintenance: maintenanceRecord[0].MAMaintenance,
      REDateProgram: new Date(date),
      REType: ReminderType.SERVICE_TODAY,
      REState: ReminderState.PENDING,
      REFSend: 'EMAIL',
      RESentAt: '',
      REDescription: 'Recordatorio de mantenimiento para hoy',
      RETitle: 'Recordatorio de mantenimiento para hoy',
    }]

    const reminderId = await generateReminder(reminderData[0]);

    await sendReminderEmail(maintenanceRecord[0], ReminderType.SERVICE_CREATED);

    const reminderTomorrowId = await generateReminder(reminderData[1]);

    const reminderTodayId = await generateReminder(reminderData[2]);
    
    res.status(201).json({ message: "Mantenimiento creado exitosamente", id: maintenanceRecord[0].MAMaintenance });
  } catch (error: unknown) {
    res.status(500).json({
      message: "Error creando el registro de mantenimiento: " + error,
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
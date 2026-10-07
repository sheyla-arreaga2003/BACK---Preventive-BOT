import { Router, type Router as ExpressRouter } from "express";
import {
  getAgencies,
  getScheduleByAgencyId,
  addMaintenance,
} from "../services/database.service.js";

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
    
    res.status(201).json({ message: "Mantenimiento creado exitosamente", id: maintenanceRecord.insertId });
  } catch (error: unknown) {
    res.status(500).json({
      message: "Error creando el registro de mantenimiento: " + error,
    });
  }
});

export default router;
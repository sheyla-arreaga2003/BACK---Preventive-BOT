import { Router, type Router as ExpressRouter } from "express";
import { executeDeclaraguate, executeVerificator } from "../services/declaraguate.service.js";
import type { DeclaraguateData } from "../interfaces/capsolver.interface.js";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import {
  addMotorcycle,
  getClientByNit,
  addProcess,
  getMotorcycleWithLatestProcessByInvoice,
  getMotorcycleByPlate,
  getMotorcyclePendingPlates,
} from "../services/database.service.js";

const router: ExpressRouter = Router();

router.post("/:motorcycleId/process", authMiddleware, authorizeRoles(1), async (req, res) => {
  const motorcycleId = Number(req.params.motorcycleId);
  const body: unknown = req.body;
  if (!Number.isSafeInteger(motorcycleId) || motorcycleId <= 0 || typeof body !== "object" || body === null) {
    return res.status(400).json({ message: "Revisa los datos del trámite" });
  }
  const value = body as Record<string, unknown>;
  const stateId = typeof value.stateId === "number" ? value.stateId : Number.NaN;
  const observations = typeof value.observations === "string" ? value.observations.trim() : "";
  if (!Number.isSafeInteger(stateId) || stateId <= 0 || observations.length > 500) {
    return res.status(400).json({ message: "Revisa los datos del trámite" });
  }
  try {
    const result = await addProcess(motorcycleId, stateId, observations, req.auth!.user.id);
    return res.status(201).json({ message: "Trámite actualizado correctamente", id: result.insertId });
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(404).json({ message: "Motocicleta o estado no encontrado" });
    }
    console.error("Error actualizando el trámite", error);
    return res.status(503).json({ message: "No fue posible actualizar el trámite" });
  }
});

router.get("/plate/:plate", async (req, res) => {
  const { plate } = req.params;

  try {
    const motorcycle = await getMotorcycleByPlate(plate);
    res.json(motorcycle);
  } catch (error: unknown) {
    res.status(500).json({
      message: "Error retrieving the motorcycle " + error,
    });
  }
});

router.get("/pendingPlates", async (req, res) => {
  const { page, pageSize } = req.query;

  if (page && isNaN(Number(page))) {
    return res.status(400).json({
      message: "Error en page: debe ser un número",
    });
  }

  if (pageSize && isNaN(Number(pageSize))) {
    return res.status(400).json({
      message: "Error en pageSize: debe ser un número",
    });
  }

  try {
    const motorcycles = await getMotorcyclePendingPlates(
      Number(page) || 1,
      Number(pageSize) || 20
    );

    res.json(motorcycles);
  } catch (error: unknown) {
    res.status(500).json({
      message: "Error obteniendo las placas pendientes: " + error,
    });
  }
});

router.post("/", authMiddleware, authorizeRoles(1), async (req, res) => {
  try {
    const {
      CUIdCustomer,
      MOPlate,
      MOBrand,
      MOModel,
      MOYear,
      MOColor,
      MOCilindraje,
      MOVin,
      MOMiles,
      MOChassis,
      MOSerieInvoice,
      MONumberInvoice,
    } = req.body;

    const client = await getClientByNit(req.body.CUIdCustomer);

    if (!client || client.length === 0) {
      return res.status(404).json({
        message: "Cliente no encontrado. Por favor registre el cliente antes de agregar una motocicleta.",
      });
    }
    
    const result = await addMotorcycle(
      client[0].CUIdCustomer,
      MOPlate,
      MOBrand,
      MOModel,
      MOYear,
      MOColor,
      MOCilindraje,
      MOVin,
      MOMiles,
      MOChassis,
      MOSerieInvoice,
      MONumberInvoice
    );
    
    
    try{
      const data: DeclaraguateData = {
        tipoVehiculo: 'particular',
        nit: `${client[0].CUNIT}`,
        marca: MOBrand,
        linea: MOModel,
        modelo: MOYear,
      }
      const resultVerificator = await executeVerificator(
        client[0].CUNIT,
        3
      );

      console.log("Result from Verificator:", resultVerificator);

      const processResultVerificador = await addProcess(result.insertId, 1, resultVerificator.message, req.auth!.user.id);

      if (!resultVerificator.message.includes("Sí")) {
        return res.status(201).json({
          message: "Motocicleta registrada correctamente",
          id: result.insertId,
          idProcess: processResultVerificador.insertId,
          observations: resultVerificator.message,
        });
      }
      
      const resultDeclaraguate = await executeDeclaraguate(
        data as DeclaraguateData
      );

      const processResult = await addProcess(result.insertId, 2, resultDeclaraguate.message, req.auth!.user.id);

      const observations = `Declaraguate executed successfully. Message: ${resultDeclaraguate.message}`;

      return res.status(201).json({
        message: "Motocicleta registrada correctamente",
        id: result.insertId,
        idProcess: processResult.insertId,
        observations: observations,
      });
    }catch (error: unknown) {
      console.error("Error durante la verificación externa de la motocicleta:", error);
      return res.status(201).json({
        message: "La motocicleta fue registrada, pero la verificación externa quedó pendiente",
        id: result.insertId,
        verificationPending: true,
      });
    }
  } catch (error: unknown) {
    res.status(500).json({
      message: "Error registrando la motocicleta: " + error,
    });
  }
});

router.get("/", async (req, res) => {
  const { serieInvoice, numberInvoice } = req.query;

  if (typeof serieInvoice !== "string" || typeof numberInvoice !== "string") {
    return res.status(400).json({
      message: "serieInvoice and numberInvoice are required",
    });
  }

  try {
    const result = await getMotorcycleWithLatestProcessByInvoice(
      serieInvoice,
      numberInvoice,
    );

    if (result.status === "not_found") {
      return res.status(404).json({
        message: "Motocicleta no encontrada",
      });
    }

    if (result.status === "ambiguous") {
      return res.status(409).json({
        message: "La factura identifica más de una motocicleta",
      });
    }

    return res.json(result.data);
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      return res.status(400).json({
        message: "Serie y número de factura son obligatorios",
      });
    }

    return res.status(503).json({
      message: "No se pudo consultar la información en este momento",
    });
  }
});

export default router;

import { Router, type Router as ExpressRouter } from "express";
import { executeDeclaraguate, executeVerificator } from "../services/declaraguate.service.js";
import type { DeclaraguateData } from "../interfaces/capsolver.interface.js";
import {
  addMotorcycle,
  getClientByNit,
  addProcess,
  getMotorcycleByInvoice,
  getMotorcycleByPlate,
  getMotorcyclePendingPlates,
} from "../services/database.service.js";

const router: ExpressRouter = Router();

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

router.post("/", async (req, res) => {
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

      const processResultVerificador = await addProcess(result.insertId, 1, resultVerificator.message);

      if (!resultVerificator.message.includes("Sí")) {
        res.status(201).json({
          message: "Motocicleta registrada correctamente",
          id: result.insertId,
          idProcess: processResultVerificador.insertId,
          observations: resultVerificator.message,
        });
      }
      
      const resultDeclaraguate = await executeDeclaraguate(
        data as DeclaraguateData
      );

      const processResult = await addProcess(result.insertId, 2, resultDeclaraguate.message);

      const observations = `Declaraguate executed successfully. Message: ${resultDeclaraguate.message}`;

      res.status(201).json({
        message: "Motocicleta registrada correctamente",
        id: result.insertId,
        idProcess: processResult.insertId,
        observations: observations,
      });
    }catch (error: unknown) {

      console.error("Error al ejecutar Declaraguate:", error);
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
    const motorcycles = await getMotorcycleByInvoice(serieInvoice, numberInvoice);

    if (motorcycles.length === 0) {
      return res.status(404).json({
        message: "Motocicleta no encontrada",
      });
    }

    return res.json(motorcycles[0]);
  } catch (error: unknown) {
    return res.status(500).json({
      message: "Error obteniendo la motocicleta: " + error,
    });
  }
});

export default router;
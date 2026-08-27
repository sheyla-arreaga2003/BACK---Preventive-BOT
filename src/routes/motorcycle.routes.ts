import { Router, type Router as ExpressRouter } from "express";
import { executeDeclaraguate } from "../services/declaraguate.service.js";
import type { DeclaraguateData } from "../interfaces/capsolver.interface.js";
import {
  addMotorcycle,
  getClientByNit,
  addProcess,
  getMotorcycleByInvoice,
} from "../services/database.service.js";

const router: ExpressRouter = Router();

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
        message: "Client not found. Please register the client before adding a motorcycle.",
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
      const resultado = await executeDeclaraguate(
        data as DeclaraguateData
      );

      const observations = `Declaraguate executed successfully. Message: ${resultado.message}`;

      const processResult = await addProcess(result.insertId, observations);
    }catch (error: unknown) {

      console.error("Error al ejecutar Declaraguate:", error);
    }

    res.status(201).json({
      message: "Motorcycle registered successfully",
      id: result.insertId,
    });
  } catch (error: unknown) {
    res.status(500).json({
      message: "Error registering the motorcycle",
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
        message: "Motorcycle not found",
      });
    }

    return res.json(motorcycles[0]);
  } catch (error: unknown) {
    return res.status(500).json({
      message: "Error retrieving the motorcycle",
    });
  }
});

export default router;
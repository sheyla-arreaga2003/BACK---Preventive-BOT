import { Router, type Router as ExpressRouter } from "express";
import { ejecutarDeclaraguate } from "../services/declaraguate.service.js";
import type { DatosDeclaraguate } from "../interfaces/capsolver.interface.js";
import { addMotorcycle, getClientByNit, addProcess } from "../services/database.service.js";

const router: ExpressRouter = Router();

router.post("/", async (req, res) => {
  console.log("Datos recibidos para registrar motocicleta:", req.body);
  
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
        message: "Cliente no encontrado. No se puede registrar la motocicleta.",
      });
    }
    
    console.log('Cliente encontrado:', client);

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
      
      const datos: DatosDeclaraguate = {
        tipoVehiculo: 'particular',
        nit: `${client.CUNIT}`,
        marca: MOBrand,
        linea: MOModel,
        modelo: MOYear,
      }
      const resultado = await ejecutarDeclaraguate(
        datos as DatosDeclaraguate
      );

      console.log("Resultado de ejecutarDeclaraguate:", resultado);

      const observations = `Declaraguate ejecutado con éxito. Mensaje: ${resultado.mensaje}`;

      const processResult = await addProcess(result.insertId, observations);
    }catch (error: unknown) {
      console.error("Error al ejecutar Declaraguate:", error);
    }

    res.status(201).json({
      message: "Motocicleta registrada correctamente",
      id: result.insertId,
    });
  } catch (error: unknown) {
    console.error("Error al registrar motocicleta:", error);

    res.status(500).json({
      message: "Error al registrar la motocicleta",
    });
  }
});

export default router;
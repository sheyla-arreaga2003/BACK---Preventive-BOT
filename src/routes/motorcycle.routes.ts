import { Router, type Router as ExpressRouter } from "express";
import type { ResultSetHeader } from "mysql2";
import pool from "../config/database.js";
import { ejecutarDeclaraguate } from "../services/declaraguate.service.js";
import type { DatosDeclaraguate } from "../interfaces/capsolver.interface.js";

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

    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO MOTORCYCLES
      (
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
        MONumberInvoice
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
      ]
    );

    try{
      const datos: DatosDeclaraguate = {
        tipoVehiculo: 'particular',
        nit: `${CUIdCustomer}`,
        marca: MOBrand,
        linea: MOModel,
        modelo: MOYear,
      }
      const resultado = await ejecutarDeclaraguate(
        datos as DatosDeclaraguate
      );

      console.log("Resultado de ejecutarDeclaraguate:", resultado);
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
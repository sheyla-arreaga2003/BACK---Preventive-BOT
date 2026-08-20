import { Router, type Router as ExpressRouter } from "express";
import type { ResultSetHeader } from "mysql2";
import pool from "../config/database.js";

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
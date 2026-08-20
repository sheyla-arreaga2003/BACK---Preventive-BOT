import { Router, type Router as ExpressRouter } from "express";
import { getClientByNit } from "../services/database.service.js";

const router: ExpressRouter = Router();

router.get("/", async (req, res) => {
  try {
    const clientes = await getClientByNit(req.query.nit as string);
    res.json(clientes);
  } catch (error: unknown) {
    console.error("Error al obtener clientes:", error);
    res.status(500).json({ message: "Error al obtener clientes" });
  }
});

router.get("/:nit", async (req, res) => {
  const { nit } = req.params;
  try {
    const cliente = await getClientByNit(nit);
    if (cliente && cliente.length > 0) {
      res.json(cliente[0]);
    } else {
      res.status(404).json({ message: "Cliente no encontrado" });
    }
  } catch (error: unknown) {
    console.error("Error al obtener cliente:", error);
    res.status(500).json({ message: "Error al obtener cliente" });
  }
});

export default router;
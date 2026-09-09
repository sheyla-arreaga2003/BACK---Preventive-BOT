import { Router, type Router as ExpressRouter } from "express";
import { getClientByNit,getClients } from "../services/database.service.js";

const router: ExpressRouter = Router();

router.get("/", async (req, res) => {
    const { page, pageSize } = req.query;

    if (page && isNaN(Number(page))) {
        return res.status(400).json({
        message: "page must be a number",
        });
    }

    if (pageSize && isNaN(Number(pageSize))) {
        return res.status(400).json({
        message: "pageSize must be a number",
        });
    }

    try {
        const clients = await getClients(Number(page) || 1, Number(pageSize) || 20);
        
        res.status(200).json(clients);
    } catch (error) {
        console.error("Error in clients route:", error);
        res.status(500).json({ message: "Internal server error" });
    }
})

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
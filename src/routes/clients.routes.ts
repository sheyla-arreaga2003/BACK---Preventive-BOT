import { Router, type Router as ExpressRouter } from "express";
import { getClientByNit, getClients, patchClient, getMotorcyclesByCustomerId, addClient } from "../services/database.service.js";

const router: ExpressRouter = Router();

router.get("/", async (req, res) => {
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
        const clients = await getClients(Number(page) || 1, Number(pageSize) || 20);
        
        res.status(200).json(clients);
    } catch (error) {
        console.error("Error in clients route:", error);
        res.status(500).json({ message: "Ocurrio un error al obtener los clientes" });
    }
})

router.get("/:nit", async (req, res) => {
  const { nit } = req.params;
  try {
    const cliente = await getClientByNit(nit);
    if (cliente && cliente.length > 0) {
      const motorcycles = await getMotorcyclesByCustomerId(cliente[0].CUIdCustomer);
      res.json({ ...cliente[0], Motorcycles: motorcycles });
    } else {
      res.status(404).json({ message: "Cliente no encontrado" });
    }
  } catch (error: unknown) {
    console.error("Error al obtener cliente:", error);
    res.status(500).json({ message: "Error al obtener cliente" });
  }
});

router.post("/", async (req, res) => {
  const { CUNIT, CUName, CULastName, CUDPI, CUPhone, CUMail, CUAddress, CUState } = req.body;

  try {
    const existingClient = await getClientByNit(CUNIT);

    if (existingClient && existingClient.length > 0) return res.status(400).json({ message: "Cliente con este NIT ya existe" });
    if (!CUNIT) return res.status(400).json({ message: "El NIT es obligatorio" });
    if (!CUName) return res.status(400).json({ message: "El nombre es obligatorio" });
    if (!CULastName) return res.status(400).json({ message: "El apellido es obligatorio" });
    if (!CUDPI) return res.status(400).json({ message: "El DPI es obligatorio" });
    if (!CUPhone) return res.status(400).json({ message: "El teléfono es obligatorio" });
    if (!CUMail) return res.status(400).json({ message: "El correo electrónico es obligatorio" });
    if (!CUAddress) return res.status(400).json({ message: "La dirección es obligatoria" });
    if (!CUState) return res.status(400).json({ message: "El estado es obligatorio" });

    const result = await addClient(CUName, CULastName, CUDPI, CUPhone, CUMail, CUAddress, CUState, CUNIT);

    res.status(201).json({ message: "Cliente agregado correctamente", CUIdCustomer: result.insertId });
  } catch (error: unknown) {
    console.error("Error al agregar cliente:", error);
    res.status(500).json({ message: "Error al agregar cliente", error: error instanceof Error ? error.message : String(error) });
  }
  
});

router.patch("/:nit", async (req, res) => {
    const { nit } = req.params;
    const { CUName, CULastName, CUPhone, CUMail, CUAddress, CUState } = req.body;

    try {
      const cliente = await getClientByNit(nit);

      if (cliente && cliente.length > 0) {
        
        await patchClient(nit, CUName, CULastName, CUPhone, CUMail, CUAddress, CUState);

        res.json({ message: "Cliente actualizado correctamente" });
      } else {
        res.status(404).json({ message: "Cliente no encontrado" });
      }
    } catch (error: unknown) {
      console.error("Error al obtener cliente:", error);
      res.status(500).json({ message: "Error al obtener cliente" });
    }
});

export default router;
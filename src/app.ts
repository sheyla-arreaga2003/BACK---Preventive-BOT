import express from "express";
import cors from "cors";
import pool from "./config/database.js";
import motorcycleRoutes from "./routes/motorcycle.routes.js";
import authRoutes from "./routes/auth.routes.js";

const app = express();
const PORT = 3000;

app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:5174"
  ]
}));

app.use(express.json());

app.use("/api/motorcycles", motorcycleRoutes);
app.use("/api/auth", authRoutes);

app.get("/", (_req, res) => {
  res.json({
    message: "API Preventive Bot funcionando"
  });
});

async function testDatabase() {
  try {
    const connection = await pool.getConnection();
    console.log("Conexión exitosa a MySQL - mototec");
    connection.release();
  } catch (error) {
    console.error("Error al conectar con MySQL:", error);
  }
}

testDatabase();

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});
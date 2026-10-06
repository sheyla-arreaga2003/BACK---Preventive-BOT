import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import pool from "./config/database.js";
import { connectRedis } from "./config/redis.js";
import motorcycleRoutes from "./routes/motorcycle.routes.js";
import authRoutes from "./routes/auth.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import clientsRoutes from "./routes/clients.routes.js";
import chatbotRoutes from "./routes/chatbot.routes.js";

const app = express();
app.use(cors({
  origin: [
    "http://localhost:5173",
    "http://localhost:5174"
  ]
}));

app.use(express.json());

app.use("/api/motorcycles", motorcycleRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/clients", clientsRoutes);
app.use("/api/chatbot", chatbotRoutes);

app.get("/", (_req, res) => {
  res.json({
    message: "API Preventive Bot is running. Please use the /api endpoints for specific functionalities.",
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

async function startApplication(): Promise<void> {
  try {
    await connectRedis();
  } catch {
    console.error("No fue posible conectar con Redis. Las rutas protegidas no estarán disponibles.");
  }

  await testDatabase();
  app.listen(env.PORT, () => {
    console.log(`Servidor ejecutándose en el puerto ${env.PORT}`);
  });
}

void startApplication();

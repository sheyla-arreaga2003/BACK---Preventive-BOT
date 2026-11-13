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
import maintenanceRoutes from "./routes/maintenance.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import profileRoutes from "./routes/profile.routes.js";
import reminderRoutes from "./routes/reminder.routes.js";
import { processPendingReminders } from "./services/reminder.service.js";
import { generateScheduledNotifications } from "./services/notification.service.js";
import { closeExpiredMaintenanceAppointments } from "./services/maintenance-appointment.service.js";

const app = express();

function isPrivateNetworkHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;

  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;

  return parts[0] === 10
    || (parts[0] === 172 && parts[1] !== undefined && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (env.CORS_ORIGINS.includes(origin)) return callback(null, true);

    try {
      const url = new URL(origin);
      return callback(null, url.protocol === "http:" && isPrivateNetworkHostname(url.hostname));
    } catch {
      return callback(null, false);
    }
  },
}));

app.use(express.json());

app.use("/api/motorcycles", motorcycleRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/clients", clientsRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/reminders", reminderRoutes);

if (env.REMINDER_WORKER_ENABLED) {
  setInterval(
    processPendingReminders,
    60_000,
  );
  setInterval(() => {
    closeExpiredMaintenanceAppointments()
      .catch((error: unknown) => console.error("Error cerrando citas vencidas", error))
      .then(generateScheduledNotifications);
  }, 60_000);
}

app.get("/", (_req, res) => {
  res.json({
    message: "API Preventive Bot is running. Please use the /api endpoints for specific functionalities.",
  });
});

async function testDatabase() {
  try {
    const connection = await pool.getConnection();
    console.log("Conexión exitosa a MySQL");
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
  app.listen(env.PORT, env.HOST, () => {
    console.log(`Servidor ejecutándose en ${env.HOST}:${env.PORT}`);
  });
}

void startApplication();

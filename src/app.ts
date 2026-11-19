import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
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
import { isCorsOriginAllowed } from "./config/cors.js";
import healthRoutes from "./routes/health.routes.js";

const app = express();
app.set("trust proxy", 1);

app.use(cors({
  origin(origin, callback) {
    return callback(null, isCorsOriginAllowed(
      origin,
      env.CORS_ORIGINS,
      env.ALLOW_PRIVATE_NETWORK_ORIGINS,
    ));
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

app.use("/health", healthRoutes);

app.get("/", (_req, res) => {
  res.json({
    message: "API Preventive Bot is running. Please use the /api endpoints for specific functionalities.",
  });
});

export default app;

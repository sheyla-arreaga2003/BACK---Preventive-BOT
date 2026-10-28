import express, { Router, type Request, type Response, type Router as ExpressRouter } from "express";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import type { MediaKind } from "../interfaces/settings.interface.js";
import {
  MAX_IMAGE_BYTES, SettingsAuthenticationError, SettingsConflictError,
  SettingsNotFoundError, SettingsValidationError, settingsService,
} from "../services/settings.service.js";

const router: ExpressRouter = Router();
const imageParser = express.raw({
  type: ["image/png", "image/jpeg", "image/webp", "application/octet-stream"],
  limit: MAX_IMAGE_BYTES,
});

router.use(authMiddleware);

function identity(req: Request) {
  if (!req.auth) throw new SettingsAuthenticationError("Unauthorized");
  return { userId: req.auth.user.id, roleId: req.auth.role.id };
}

function bodyRecord(req: Request): Record<string, unknown> {
  return typeof req.body === "object" && req.body !== null && !Buffer.isBuffer(req.body)
    ? req.body as Record<string, unknown>
    : {};
}

function handleError(error: unknown, res: Response) {
  if (error instanceof SettingsValidationError) return res.status(400).json({ message: error.message });
  if (error instanceof SettingsAuthenticationError) return res.status(401).json({ message: error.message });
  if (error instanceof SettingsConflictError) return res.status(409).json({ message: error.message });
  if (error instanceof SettingsNotFoundError) return res.status(404).json({ message: error.message });
  console.error("Settings request failed", error);
  return res.status(500).json({ message: "No fue posible procesar la configuración" });
}

router.get("/profile", async (req, res) => {
  try { return res.json(await settingsService.profile(identity(req).userId)); }
  catch (error) { return handleError(error, res); }
});

router.patch("/profile", async (req, res) => {
  try { return res.json(await settingsService.updateProfile(identity(req).userId, bodyRecord(req))); }
  catch (error) { return handleError(error, res); }
});

router.put("/password", async (req, res) => {
  try {
    await settingsService.changePassword(identity(req).userId, bodyRecord(req));
    return res.json({ message: "Contraseña actualizada correctamente" });
  } catch (error) { return handleError(error, res); }
});

router.get("/preferences", async (req, res) => {
  try {
    const { userId, roleId } = identity(req);
    return res.json(await settingsService.preferences(userId, roleId));
  } catch (error) { return handleError(error, res); }
});

router.patch("/preferences", async (req, res) => {
  try {
    const { userId, roleId } = identity(req);
    return res.json(await settingsService.updatePreferences(userId, roleId, bodyRecord(req)));
  } catch (error) { return handleError(error, res); }
});

router.delete("/preferences", async (req, res) => {
  try {
    const { userId, roleId } = identity(req);
    return res.json(await settingsService.resetPreferences(userId, roleId));
  } catch (error) { return handleError(error, res); }
});

router.get("/modules", (req, res) => {
  try { return res.json({ data: settingsService.moduleCatalog(identity(req).roleId) }); }
  catch (error) { return handleError(error, res); }
});

function mediaRoutes(path: string, kind: MediaKind) {
  router.get(path, async (req, res) => {
    try {
      const media = await settingsService.getMedia(identity(req).userId, kind);
      if (!media) return res.status(404).json({ message: "Imagen no registrada" });
      res.setHeader("Content-Type", media.UMMimeType);
      res.setHeader("Content-Length", String(media.UMSize));
      res.setHeader("Cache-Control", "private, no-store");
      return res.send(media.UMContent);
    } catch (error) { return handleError(error, res); }
  });

  router.put(path, (req, res, next) => imageParser(req, res, (error) => {
    if (error) return res.status(413).json({ message: "Image must not exceed 2 MB" });
    return next();
  }), async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.body)) throw new SettingsValidationError("Image body is required");
      return res.json(await settingsService.saveMedia(identity(req).userId, kind, req.body));
    } catch (error) { return handleError(error, res); }
  });

  router.delete(path, async (req, res) => {
    try { return res.json({ deleted: await settingsService.deleteMedia(identity(req).userId, kind) }); }
    catch (error) { return handleError(error, res); }
  });
}

mediaRoutes("/avatar", "AVATAR");
mediaRoutes("/background-image", "BACKGROUND");

export default router;

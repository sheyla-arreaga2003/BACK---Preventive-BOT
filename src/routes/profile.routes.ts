import { Router, type Response, type Router as ExpressRouter } from "express";
import { authMiddleware, authorizeRoles } from "../middlewares/auth.middleware.js";
import {
  listUserSessions, revokeOtherUserSessions, revokeUserSession,
} from "../services/auth.service.js";
import {
  ProfileNotFoundError, ProfileValidationError, profileService,
} from "../services/profile.service.js";

const router: ExpressRouter = Router();
const ADMIN_ROLE_ID = 1;

router.use(authMiddleware, authorizeRoles(ADMIN_ROLE_ID));

function optionalDate(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ProfileValidationError("El período indicado no es válido");
  return value;
}

function positiveInteger(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new ProfileValidationError("La paginación no es válida");
  return Number(value);
}

function sessionReference(value: string): string {
  if (!/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(value)) {
    throw new ProfileValidationError("La referencia de sesión no es válida");
  }
  return value;
}

function handleError(error: unknown, res: Response) {
  if (error instanceof ProfileValidationError) return res.status(400).json({ message: error.message });
  if (error instanceof ProfileNotFoundError) return res.status(404).json({ message: error.message });
  console.error("Profile request failed", error);
  return res.status(503).json({ message: "No fue posible consultar el perfil" });
}

router.get("/overview", async (req, res) => {
  try {
    return res.json(await profileService.overview(
      req.auth!.user.id,
      optionalDate(req.query.from),
      optionalDate(req.query.to),
    ));
  } catch (error) { return handleError(error, res); }
});

router.get("/activity", async (req, res) => {
  try {
    return res.json(await profileService.activityPage(
      req.auth!.user.id,
      positiveInteger(req.query.page, 1),
      positiveInteger(req.query.pageSize, 20),
      optionalDate(req.query.from),
      optionalDate(req.query.to),
    ));
  } catch (error) { return handleError(error, res); }
});

router.get("/sessions", async (req, res) => {
  try {
    return res.json({ sessions: await listUserSessions(req.auth!.user.id, req.auth!.session.id) });
  } catch (error) { return handleError(error, res); }
});

router.delete("/sessions/others", async (req, res) => {
  try {
    const deleted = await revokeOtherUserSessions(req.auth!.user.id, req.auth!.session.id);
    return res.json({ deleted });
  } catch (error) { return handleError(error, res); }
});

router.delete("/sessions/:reference", async (req, res) => {
  try {
    const result = await revokeUserSession(
      req.auth!.user.id,
      req.auth!.session.id,
      sessionReference(req.params.reference),
    );
    if (result === "not_found") return res.status(404).json({ message: "Sesión no encontrada" });
    if (result === "current") return res.status(409).json({ message: "Utiliza cerrar sesión para finalizar la sesión actual" });
    return res.json({ deleted: true });
  } catch (error) { return handleError(error, res); }
});

export default router;


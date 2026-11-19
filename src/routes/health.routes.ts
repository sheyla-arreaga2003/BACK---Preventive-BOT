import { Router } from "express";
import { readiness, type ReadinessResult } from "../services/health.service.js";

export function createHealthRouter(
  readinessCheck: () => Promise<ReadinessResult> = readiness,
): Router {
  const router = Router();
  router.get("/live", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
  router.get("/ready", async (_req, res) => {
    const result = await readinessCheck();
    res.status(result.ready ? 200 : 503).json(result);
  });
  return router;
}

export default createHealthRouter();

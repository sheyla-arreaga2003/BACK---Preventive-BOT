import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import dashboardRoutes from "../src/routes/dashboard.routes.js";
import motorcycleRoutes from "../src/routes/motorcycle.routes.js";

function securityTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/motorcycles", motorcycleRoutes);
  return app;
}

test("legacy dashboard operations reject unauthenticated requests", async () => {
  const app = securityTestApp();
  const cases = [
    request(app).get("/api/dashboard/agencies"),
    request(app).get("/api/dashboard/schedule?id=1&date=2026-11-20"),
    request(app).post("/api/dashboard/maintenance").send({}),
    request(app).get("/api/dashboard/test-email"),
  ];
  const responses = await Promise.all(cases);
  assert.deepEqual(responses.map(({ status }) => status), [401, 401, 401, 401]);
});

test("legacy motorcycle lookups reject unauthenticated requests", async () => {
  const app = securityTestApp();
  const cases = [
    request(app).get("/api/motorcycles/plate/ABC123"),
    request(app).get("/api/motorcycles/pendingPlates"),
    request(app).get("/api/motorcycles?serieInvoice=SER&numberInvoice=0001"),
  ];
  const responses = await Promise.all(cases);
  assert.deepEqual(responses.map(({ status }) => status), [401, 401, 401]);
});

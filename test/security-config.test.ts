import assert from "node:assert/strict";
import test from "node:test";
import { isCorsOriginAllowed, parseCorsOrigins } from "../src/config/cors.js";
import { hashPassword, isArgon2idHash, verifyPassword } from "../src/services/password.service.js";

test("Argon2id hashes new passwords and rejects an incorrect password", async () => {
  const stored = await hashPassword("contraseña-segura-de-prueba");
  assert.equal(isArgon2idHash(stored), true);
  assert.deepEqual(await verifyPassword(stored, "contraseña-segura-de-prueba"), {
    valid: true,
    needsUpgrade: false,
  });
  assert.equal((await verifyPassword(stored, "incorrecta")).valid, false);
});

test("legacy SHA-256 remains valid only to perform the gradual upgrade", async () => {
  const crypto = await import("node:crypto");
  const legacy = crypto.createHash("sha256").update("contraseña-anterior").digest("hex");
  assert.deepEqual(await verifyPassword(legacy, "contraseña-anterior"), {
    valid: true,
    needsUpgrade: true,
  });
  assert.equal((await verifyPassword(legacy, "incorrecta")).valid, false);
});

test("CORS accepts only configured origins in production mode", () => {
  const allowed = parseCorsOrigins("https://preventive.example,https://admin.example");
  assert.equal(isCorsOriginAllowed("https://preventive.example", allowed, false), true);
  assert.equal(isCorsOriginAllowed("https://other.example", allowed, false), false);
  assert.equal(isCorsOriginAllowed("http://192.168.1.20:5173", allowed, false), false);
  assert.equal(isCorsOriginAllowed(undefined, allowed, false), true);
});

test("CORS local-network support is explicit and wildcards are rejected", () => {
  assert.equal(isCorsOriginAllowed("http://192.168.1.20:5173", [], true), true);
  assert.equal(isCorsOriginAllowed("https://192.168.1.20:5173", [], true), false);
  assert.throws(() => parseCorsOrigins("*"), /wildcard/);
});

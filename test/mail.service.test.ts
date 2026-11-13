import assert from "node:assert/strict";
import test from "node:test";
import { createGmailTransport } from "../src/services/mail.service.js";

test("configura Gmail con STARTTLS y contraseña de aplicación", () => {
  const captured: Record<string, unknown>[] = [];
  createGmailTransport({ host: "smtp.gmail.com", port: 587, user: "mototec.fixture@gmail.com", from: "Mototec <mototec.fixture@gmail.com>", password: "app-password-fixture" }, (received) => {
    captured.push(received);
    return { sendMail: async () => ({}), verify: async () => true };
  });
  const options = captured[0];
  assert.ok(options);
  assert.equal(options.host, "smtp.gmail.com");
  assert.equal(options.port, 587);
  assert.equal(options.secure, false);
  assert.equal(options.requireTLS, true);
  assert.deepEqual(options.auth, { user: "mototec.fixture@gmail.com", pass: "app-password-fixture" });
});

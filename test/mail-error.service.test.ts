import assert from "node:assert/strict";
import test from "node:test";
import { classifyMailError, sanitizeMailErrorDetail } from "../src/services/mail-error.service.js";

const cases = [
  [{ code: "EAUTH", responseCode: 535, message: "Username and Password not accepted" }, "AUTHENTICATION"],
  [{ responseCode: 534, response: "Application-specific password required" }, "ACCOUNT_AUTHORIZATION"],
  [{ code: "ETIMEDOUT", message: "Connection timeout" }, "CONNECTION"],
  [{ code: "EENVELOPE", responseCode: 550, rejected: ["invalid@example.com"] }, "RECIPIENT_REJECTED"],
  [{ responseCode: 421, response: "Service temporarily unavailable" }, "PROVIDER_TEMPORARY"],
  [{ responseCode: 454, response: "4.7.0 Too many messages, daily user sending quota exceeded" }, "SEND_LIMIT"],
  [new Error("Unexpected transport failure"), "UNKNOWN"],
] as const;

for (const [error, expected] of cases) {
  test(`clasifica ${expected}`, () => {
    const result = classifyMailError(error);
    assert.equal(result.category, expected);
    assert.ok(result.message.length > 0);
    assert.ok(result.recommendation.length > 0);
    assert.ok(result.title.length > 0);
    assert.ok(result.attemptStatus.length > 0);
    assert.equal(typeof result.retryable, "boolean");
    assert.doesNotMatch(result.message, /535|smtp|password/i);
  });
}

test("interpreta errores históricos sin devolver la cadena técnica", () => {
  const result = classifyMailError("Invalid login: 535-5.7.8 Username and Password not accepted");
  assert.equal(result.category, "AUTHENTICATION");
  assert.doesNotMatch(JSON.stringify(result), /Invalid login|535-5\.7\.8/);
});

test("conserva el diagnóstico interno sin almacenar secretos", () => {
  const detail = sanitizeMailErrorDetail("EAUTH password=supersecreto token:abc123 fallo 535");
  assert.match(detail, /EAUTH/);
  assert.match(detail, /fallo 535/);
  assert.doesNotMatch(detail, /supersecreto|abc123/);
});

import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Request, Response } from "express";
import { authorizeRoles, createAuthMiddleware } from "../src/middlewares/auth.middleware.js";

function createResponse(): { response: Response; getStatus: () => number; getBody: () => unknown } {
  let statusCode = 200;
  let body: unknown;
  const responseShape: { status: (code: number) => Response; json: (value: unknown) => Response } = {
    status(code) {
      statusCode = code;
      return responseShape as unknown as Response;
    },
    json(value) {
      body = value;
      return responseShape as unknown as Response;
    },
  };
  return {
    response: responseShape as unknown as Response,
    getStatus: () => statusCode,
    getBody: () => body,
  };
}

test("returns 401 when the authenticated user no longer exists", async () => {
  const middleware = createAuthMiddleware(
    async () => ({
      success: true,
      userId: 7,
      sessionid: "98cdd953-e2e6-4429-8970-e5799c249fcc",
      session: { userId: 7, email: "user@example.com" },
    }),
    async () => null,
  );
  const req = { headers: { authorization: "Bearer token" } } as Request;
  const result = createResponse();
  let nextCalled = false;
  await middleware(req, result.response, (() => { nextCalled = true; }) as NextFunction);
  assert.equal(result.getStatus(), 401);
  assert.equal(nextCalled, false);
});

test("returns 503 when MySQL identity lookup fails", async () => {
  const middleware = createAuthMiddleware(
    async () => ({
      success: true,
      userId: 7,
      sessionid: "98cdd953-e2e6-4429-8970-e5799c249fcc",
      session: { userId: 7, email: "user@example.com" },
    }),
    async () => { throw new Error("database unavailable"); },
  );
  const req = { headers: { authorization: "Bearer token" } } as Request;
  const result = createResponse();
  await middleware(req, result.response, (() => undefined) as NextFunction);
  assert.equal(result.getStatus(), 503);
  assert.deepEqual(result.getBody(), { message: "Authentication service unavailable" });
});

test("returns 403 when the authenticated role is not allowed", () => {
  const middleware = authorizeRoles(10, 20);
  const req = {
    headers: {},
    auth: {
      user: { id: 7, name: "Test", lastName: "User", email: "user@example.com", phone: null },
      session: { id: "98cdd953-e2e6-4429-8970-e5799c249fcc" },
      role: { id: 30 },
    },
  } as Request;
  const result = createResponse();
  let nextCalled = false;
  middleware(req, result.response, (() => { nextCalled = true; }) as NextFunction);
  assert.equal(result.getStatus(), 403);
  assert.equal(nextCalled, false);
});

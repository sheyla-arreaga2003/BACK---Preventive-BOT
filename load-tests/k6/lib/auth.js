import http from "k6/http";
import { fail } from "k6";
import { BASE_URL } from "./config.js";

const jsonHeaders = { "Content-Type": "application/json" };

function credentials() {
  const email = (__ENV.K6_TEST_EMAIL || "").trim();
  const password = __ENV.K6_TEST_PASSWORD || "";
  if (!email || !password) {
    fail("Faltan K6_TEST_EMAIL o K6_TEST_PASSWORD.");
  }
  return { email, password };
}

function parseJson(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

export function authorizationHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

export function openAuthenticatedSession() {
  const response = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify(credentials()),
    { headers: jsonHeaders, tags: { name: "auth_login_setup" } },
  );
  const payload = parseJson(response);
  if (response.status !== 200 || !payload || typeof payload.token !== "string" || typeof payload.sessionid !== "string") {
    fail(`No fue posible iniciar la sesión de prueba (HTTP ${response.status}).`);
  }

  assertSessionAlive(payload.token);
  return { token: payload.token };
}

export function assertSessionAlive(token) {
  const response = http.get(`${BASE_URL}/api/clients?page=1&pageSize=1`, {
    headers: authorizationHeaders(token),
    tags: { name: "auth_session_check" },
  });
  if (response.status !== 200) {
    fail(`La sesión de prueba dejó de ser válida (HTTP ${response.status}).`);
  }
}

export function closeAuthenticatedSession(data) {
  if (!data || typeof data.token !== "string") return;
  const validation = http.get(`${BASE_URL}/api/clients?page=1&pageSize=1`, {
    headers: authorizationHeaders(data.token),
    tags: { name: "auth_final_session_check" },
  });
  if (validation.status !== 200) {
    console.error(`La sesión no era válida al finalizar (HTTP ${validation.status}).`);
  }
  const response = http.post(`${BASE_URL}/api/auth/logout`, null, {
    headers: authorizationHeaders(data.token),
    tags: { name: "auth_logout_teardown" },
  });
  if (response.status !== 200 && response.status !== 401) {
    console.error(`No fue posible cerrar la sesión de prueba (HTTP ${response.status}).`);
  }
}

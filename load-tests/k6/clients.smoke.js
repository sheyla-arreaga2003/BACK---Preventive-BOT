import { sleep } from "k6";
import { openAuthenticatedSession, closeAuthenticatedSession } from "./lib/auth.js";
import { BASE_URL, PAGE, PAGE_SIZE, PAUSE_SECONDS, smokeOptions } from "./lib/config.js";
import { createEndpointMetrics, queryEndpoint, validateClients } from "./lib/endpoint.js";
import { summaryHandler } from "./lib/summary.js";

const metrics = createEndpointMetrics("clients");
export const options = smokeOptions(metrics.key);
export const setup = openAuthenticatedSession;

export default function (data) {
  queryEndpoint({
    url: `${BASE_URL}/api/clients?page=${PAGE}&pageSize=${PAGE_SIZE}`,
    token: data.token,
    label: "GET /api/clients",
    metrics,
    validate: validateClients,
  });
  sleep(PAUSE_SECONDS);
}

export const teardown = closeAuthenticatedSession;
export const handleSummary = summaryHandler({
  key: metrics.key,
  endpoint: "GET /api/clients",
  kind: "smoke",
  outputPath: "load-tests/k6/results/clients-smoke-summary.json",
});

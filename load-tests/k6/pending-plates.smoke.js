import { sleep } from "k6";
import { openAuthenticatedSession, closeAuthenticatedSession } from "./lib/auth.js";
import { BASE_URL, PAGE, PAGE_SIZE, PAUSE_SECONDS, smokeOptions } from "./lib/config.js";
import { createEndpointMetrics, queryEndpoint, validatePendingPlates } from "./lib/endpoint.js";
import { summaryHandler } from "./lib/summary.js";

const metrics = createEndpointMetrics("pending_plates");
export const options = smokeOptions(metrics.key);
export const setup = openAuthenticatedSession;

export default function (data) {
  queryEndpoint({
    url: `${BASE_URL}/api/motorcycles/pendingPlates?page=${PAGE}&pageSize=${PAGE_SIZE}`,
    token: data.token,
    label: "GET /api/motorcycles/pendingPlates",
    metrics,
    validate: validatePendingPlates,
  });
  sleep(PAUSE_SECONDS);
}

export const teardown = closeAuthenticatedSession;
export const handleSummary = summaryHandler({
  key: metrics.key,
  endpoint: "GET /api/motorcycles/pendingPlates",
  kind: "smoke",
  outputPath: "load-tests/k6/results/pending-plates-smoke-summary.json",
});

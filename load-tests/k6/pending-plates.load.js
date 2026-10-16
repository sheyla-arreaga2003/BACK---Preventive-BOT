import { sleep } from "k6";
import { openAuthenticatedSession, assertSessionAlive, closeAuthenticatedSession } from "./lib/auth.js";
import { BASE_URL, PAGE, PAGE_SIZE, PAUSE_SECONDS, SESSION_CHECK_EVERY, loadOptions } from "./lib/config.js";
import { createEndpointMetrics, queryEndpoint, validatePendingPlates } from "./lib/endpoint.js";
import { summaryHandler } from "./lib/summary.js";

const metrics = createEndpointMetrics("pending_plates");
export const options = loadOptions;
export const setup = openAuthenticatedSession;

export default function (data) {
  if (__ITER > 0 && __ITER % SESSION_CHECK_EVERY === 0) {
    assertSessionAlive(data.token);
  }
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
  kind: "load",
  outputPath: "load-tests/k6/results/pending-plates-load-summary.json",
});

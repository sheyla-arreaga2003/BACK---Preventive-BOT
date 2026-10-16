import { sleep } from "k6";
import execution from "k6/execution";
import { openAuthenticatedSession, closeAuthenticatedSession } from "./lib/auth.js";
import { BASE_URL, PAGE, PAGE_SIZE, PAUSE_SECONDS } from "./lib/config.js";
import { createEndpointMetrics, queryEndpoint, validateClients } from "./lib/endpoint.js";
import { summaryHandler } from "./lib/summary.js";

const HOLD_50_START_MS = 330_000;
const HOLD_50_END_MS = 450_000;
const metrics = createEndpointMetrics("clients_50");
const outputPath = (__ENV.K6_RESULT_FILE || "load-tests/k6/results/clients-load-50vus-summary.json").trim();

export const options = {
  scenarios: {
    clients_50_users: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: "30s", target: 1 },
        { duration: "30s", target: 10 },
        { duration: "1m", target: 10 },
        { duration: "30s", target: 20 },
        { duration: "1m", target: 20 },
        { duration: "30s", target: 30 },
        { duration: "1m", target: 30 },
        { duration: "30s", target: 50 },
        { duration: "2m", target: 50 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  summaryTrendStats: ["avg", "med", "p(95)", "max"],
  thresholds: {
    "clients_50_requests{phase:hold_50}": ["count>=0"],
    "clients_50_errors{phase:hold_50}": ["rate>=0"],
    "clients_50_duration{phase:hold_50}": ["p(95)>=0"],
    "clients_50_content_checks_passed{phase:hold_50}": ["count>=0"],
    "clients_50_content_checks_failed{phase:hold_50}": ["count>=0"],
    "clients_50_rate_limited{phase:hold_50}": ["count>=0"],
  },
};

export const setup = openAuthenticatedSession;

export default function (data) {
  const elapsedMs = Date.now() - execution.scenario.startTime;
  const phase = elapsedMs >= HOLD_50_START_MS && elapsedMs < HOLD_50_END_MS
    ? "hold_50"
    : "other";

  queryEndpoint({
    url: `${BASE_URL}/api/clients?page=${PAGE}&pageSize=${PAGE_SIZE}`,
    token: data.token,
    label: "GET /api/clients (50 VUs)",
    metrics,
    validate: validateClients,
    metricTags: { phase },
  });
  sleep(PAUSE_SECONDS);
}

export const teardown = closeAuthenticatedSession;
export const handleSummary = summaryHandler({
  key: metrics.key,
  endpoint: "GET /api/clients",
  kind: "load-50-vus",
  outputPath,
  phases: [
    { id: "hold50", tag: "hold_50", label: "Mantenimiento de 50 usuarios (2 minutos)" },
  ],
});

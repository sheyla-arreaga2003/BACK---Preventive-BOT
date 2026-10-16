export const BASE_URL = (__ENV.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
export const PAGE = positiveInteger(__ENV.K6_PAGE, 1);
export const PAGE_SIZE = positiveInteger(__ENV.K6_PAGE_SIZE, 20);
export const PAUSE_SECONDS = positiveNumber(__ENV.K6_PAUSE_SECONDS, 1);
export const SESSION_CHECK_EVERY = positiveInteger(__ENV.K6_SESSION_CHECK_EVERY, 30);

function positiveInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function positiveNumber(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const loadOptions = {
  scenarios: {
    gradual_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "10s", target: 1 },
        { duration: "1m", target: 1 },
        { duration: "30s", target: 5 },
        { duration: "1m", target: 5 },
        { duration: "30s", target: 10 },
        { duration: "1m", target: 10 },
        { duration: "30s", target: 20 },
        { duration: "1m", target: 20 },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  summaryTrendStats: ["avg", "med", "p(95)", "max"],
};

export function smokeOptions(metricKey) {
  return {
    vus: 1,
    iterations: 1,
    summaryTrendStats: ["avg", "med", "p(95)", "max"],
    thresholds: {
      [`${metricKey}_errors`]: ["rate==0"],
      [`${metricKey}_content_checks_failed`]: ["count==0"],
    },
  };
}

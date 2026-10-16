import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { authorizationHeaders } from "./auth.js";

export function createEndpointMetrics(key) {
  return {
    key,
    requests: new Counter(`${key}_requests`),
    errors: new Rate(`${key}_errors`),
    duration: new Trend(`${key}_duration`, true),
    rateLimited: new Counter(`${key}_rate_limited`),
    contentPassed: new Counter(`${key}_content_checks_passed`),
    contentFailed: new Counter(`${key}_content_checks_failed`),
  };
}

function parseJson(response) {
  try {
    return response.json();
  } catch {
    return null;
  }
}

export function queryEndpoint({ url, token, label, metrics, validate, metricTags = {} }) {
  const response = http.get(url, {
    headers: authorizationHeaders(token),
    tags: { name: label, endpoint: metrics.key, ...metricTags },
  });
  const statusValid = response.status === 200;
  const payload = statusValid ? parseJson(response) : null;
  const contentValid = statusValid && validate(payload);

  metrics.requests.add(1, metricTags);
  metrics.duration.add(response.timings.duration, metricTags);
  metrics.errors.add(!statusValid, metricTags);
  metrics.rateLimited.add(response.status === 429 ? 1 : 0, metricTags);
  metrics.contentPassed.add(contentValid ? 1 : 0, metricTags);
  metrics.contentFailed.add(contentValid ? 0 : 1, metricTags);

  check(response, {
    [`${label}: HTTP 200`]: () => statusValid,
    [`${label}: estructura esperada`]: () => contentValid,
    [`${label}: no fue rechazada`]: () => ![401, 403, 429, 500].includes(response.status),
  });
}

function isPagination(value) {
  return value !== null
    && typeof value === "object"
    && Number.isInteger(value.page)
    && Number.isInteger(value.pageSize)
    && Number.isInteger(value.total)
    && Number.isInteger(value.totalPages);
}

export function validateClients(payload) {
  return payload !== null
    && typeof payload === "object"
    && Array.isArray(payload.data)
    && payload.data.every((item) => item !== null && typeof item === "object" && Number.isInteger(item.CUIdCustomer))
    && isPagination(payload.pagination);
}

export function validatePendingPlates(payload) {
  return payload !== null
    && typeof payload === "object"
    && Array.isArray(payload.data)
    && payload.data.every((item) => item !== null && typeof item === "object" && Number.isInteger(item.MOIdMoto))
    && isPagination(payload.pagination);
}

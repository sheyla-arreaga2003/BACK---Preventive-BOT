function metricValue(data, name, field, fallback = 0) {
  const metric = data.metrics[name];
  const value = metric && metric.values ? metric.values[field] : undefined;
  return typeof value === "number" ? value : fallback;
}

function rounded(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function measurements(data, key, suffix = "") {
  return {
    totalRequests: metricValue(data, `${key}_requests${suffix}`, "count"),
    requestsPerSecond: rounded(metricValue(data, `${key}_requests${suffix}`, "rate")),
    errorPercentage: rounded(metricValue(data, `${key}_errors${suffix}`, "rate") * 100),
    responseTimeMs: {
      average: rounded(metricValue(data, `${key}_duration${suffix}`, "avg")),
      median: rounded(metricValue(data, `${key}_duration${suffix}`, "med")),
      percentile95: rounded(metricValue(data, `${key}_duration${suffix}`, "p(95)")),
      maximum: rounded(metricValue(data, `${key}_duration${suffix}`, "max")),
    },
    contentChecks: {
      passed: metricValue(data, `${key}_content_checks_passed${suffix}`, "count"),
      failed: metricValue(data, `${key}_content_checks_failed${suffix}`, "count"),
    },
    rateLimitedResponses: metricValue(data, `${key}_rate_limited${suffix}`, "count"),
  };
}

export function summaryHandler({ key, endpoint, kind, outputPath, phases = [] }) {
  return (data) => {
    const phaseMeasurements = Object.fromEntries(
      phases.map((phase) => [
        phase.id,
        {
          label: phase.label,
          measurements: measurements(data, key, `{phase:${phase.tag}}`),
        },
      ]),
    );
    const report = {
      generatedAt: new Date().toISOString(),
      test: kind,
      endpoint,
      exploratory: true,
      measurements: measurements(data, key),
      ...(phases.length > 0 ? { phases: phaseMeasurements } : {}),
      note: "Mediciones exploratorias; no existen criterios de aceptación de rendimiento definidos.",
    };
    const text = [
      `\n${endpoint} (${kind})`,
      `Solicitudes: ${report.measurements.totalRequests}`,
      `Solicitudes/s: ${report.measurements.requestsPerSecond}`,
      `Errores: ${report.measurements.errorPercentage}%`,
      `Respuesta ms — prom: ${report.measurements.responseTimeMs.average}, med: ${report.measurements.responseTimeMs.median}, p95: ${report.measurements.responseTimeMs.percentile95}, máx: ${report.measurements.responseTimeMs.maximum}`,
      `Contenido — aprobadas: ${report.measurements.contentChecks.passed}, fallidas: ${report.measurements.contentChecks.failed}`,
      `HTTP 429: ${report.measurements.rateLimitedResponses}`,
      ...phases.flatMap((phase) => {
        const values = phaseMeasurements[phase.id].measurements;
        return [
          `\n${phase.label}`,
          `Solicitudes: ${values.totalRequests}`,
          `Solicitudes/s: ${values.requestsPerSecond}`,
          `Errores: ${values.errorPercentage}%`,
          `Respuesta ms — prom: ${values.responseTimeMs.average}, med: ${values.responseTimeMs.median}, p95: ${values.responseTimeMs.percentile95}, máx: ${values.responseTimeMs.maximum}`,
          `Contenido — aprobadas: ${values.contentChecks.passed}, fallidas: ${values.contentChecks.failed}`,
        ];
      }),
      `Resultado guardado en ${outputPath}\n`,
    ].join("\n");
    return { stdout: text, [outputPath]: JSON.stringify(report, null, 2) };
  };
}

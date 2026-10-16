import type { RowDataPacket } from "mysql2";
import pool from "../config/database.js";

export type PlateStageStatus = "completed" | "current" | "pending";

export interface PlateTrackingStage {
  key: string;
  label: string;
  percentage: number;
  status: PlateStageStatus;
  registeredDate: string | null;
}

export interface PlateTrackingHistoryItem {
  state: string;
  registeredDate: string;
  updatedDate: string | null;
}

export interface PlateTracking {
  currentState: string | null;
  percentage: number | null;
  updatedDate: string | null;
  stages: PlateTrackingStage[];
  history: PlateTrackingHistoryItem[];
}

interface ProcessRow extends RowDataPacket {
  PRIdProcess: number;
  STState: string;
  PRFirstDate: string;
  PRDateUpdate: string | null;
}

const stageDefinitions = [
  { key: "start", label: "Inicio del trámite", percentage: 0, stateNames: [] as string[] },
  { key: "nit-verification", label: "Verificación de NIT", percentage: 20, stateNames: ["Verificación de NIT"] },
  { key: "first-plate-request", label: "Solicitud primeras placas", percentage: 40, stateNames: ["Solicitud primeras placas"] },
  { key: "iprima-payment", label: "Pago IPRIMA registrado", percentage: 60, stateNames: ["Pago IPRIMA registrado"] },
  { key: "documents", label: "Documentos presentados y contraseña de pago recibida", percentage: 75, stateNames: ["Documentos presentados y contraseña de pago recibida"] },
  { key: "final-payment", label: "Pago final registrado y gestión finalizada", percentage: 90, stateNames: ["Pago final registrado y gestión finalizada"] },
  { key: "plates-received", label: "Placas recibidas en Mototec", percentage: 100, stateNames: ["Placas recibidas en Mototec"] },
] as const;

function normalizeState(value: string): string {
  return value.trim().toLocaleLowerCase("es-GT");
}

export function buildPlateTracking(rows: readonly ProcessRow[]): PlateTracking {
  const history = rows.map((row) => ({
    state: row.STState,
    registeredDate: row.PRFirstDate,
    updatedDate: row.PRDateUpdate,
  }));
  const latest = rows.at(-1) ?? null;
  const currentDefinition = latest
    ? stageDefinitions.find((stage) => stage.stateNames.some((name) => normalizeState(name) === normalizeState(latest.STState))) ?? null
    : null;

  const recordedByStage = new Map<string, ProcessRow>();
  for (const row of rows) {
    const definition = stageDefinitions.find((stage) => stage.stateNames.some((name) => normalizeState(name) === normalizeState(row.STState)));
    if (definition) recordedByStage.set(definition.key, row);
  }

  return {
    currentState: latest?.STState ?? null,
    percentage: currentDefinition?.percentage ?? (rows.length === 0 ? 0 : null),
    updatedDate: latest?.PRDateUpdate ?? latest?.PRFirstDate ?? null,
    stages: stageDefinitions.map((stage) => {
      const recorded = stage.key === "start" ? rows[0] : recordedByStage.get(stage.key);
      return {
        key: stage.key,
        label: stage.label,
        percentage: stage.percentage,
        status: currentDefinition?.key === stage.key ? "current" : recorded ? "completed" : "pending",
        registeredDate: recorded?.PRFirstDate ?? null,
      };
    }),
    history: history.slice().reverse(),
  };
}

export async function getPlateTrackingByMotorcycle(motorcycleId: number): Promise<PlateTracking> {
  const [rows] = await pool.execute<ProcessRow[]>(`
    SELECT P.PRIdProcess,
      SP.STState,
      DATE_FORMAT(P.PRFirstDate, '%Y-%m-%d') AS PRFirstDate,
      DATE_FORMAT(P.PRDateUpdate, '%Y-%m-%d') AS PRDateUpdate
    FROM PROCESSING P
    INNER JOIN STATE_PLATE SP ON SP.STIdState = P.STIdState
    WHERE P.MOIdMoto = ?
    ORDER BY P.PRIdProcess ASC
  `, [motorcycleId]);
  return buildPlateTracking(rows);
}

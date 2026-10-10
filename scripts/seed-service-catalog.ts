import type { ResultSetHeader, RowDataPacket } from "mysql2";
import "../src/config/env.js";
import pool from "../src/config/database.js";

interface ServiceDefinition {
  name: string;
  description: string;
}

interface ServiceRow extends RowDataPacket {
  SEIdService: number;
  SEName: string;
}

const catalog: readonly ServiceDefinition[] = [
  { name: "Cambio de aceite del motor", description: "Sustitución del aceite para mantener lubricadas las piezas internas del motor." },
  { name: "Cambio de filtro de aceite", description: "Reemplazo del filtro que retiene impurezas del aceite, cuando corresponda al modelo." },
  { name: "Limpieza o cambio de filtro de aire", description: "Revisión del filtro y limpieza o sustitución según su tipo y condición." },
  { name: "Revisión de bujía", description: "Inspección y cambio de la bujía cuando presente desgaste o fallas." },
  { name: "Revisión de frenos", description: "Inspección de pastillas, zapatas, discos y funcionamiento del sistema." },
  { name: "Cambio de líquido de frenos", description: "Sustitución del líquido en motocicletas con frenos hidráulicos." },
  { name: "Ajuste y lubricación de cadena", description: "Limpieza, lubricación y ajuste de la tensión de la cadena." },
  { name: "Revisión del kit de arrastre", description: "Inspección del desgaste de cadena, piñón y corona." },
  { name: "Revisión de neumáticos", description: "Verificación de presión, desgaste y posibles daños." },
  { name: "Revisión de batería", description: "Comprobación de carga, terminales y estado general." },
  { name: "Revisión de luces y sistema eléctrico", description: "Verificación de luces, direccionales, bocina y conexiones." },
  { name: "Ajuste de embrague y acelerador", description: "Revisión del funcionamiento y ajuste de cables, cuando corresponda." },
  { name: "Revisión de suspensión", description: "Inspección de amortiguadores, horquilla y posibles fugas." },
  { name: "Revisión del sistema de refrigeración", description: "Inspección de refrigerante, mangueras y fugas en modelos que utilicen este sistema." },
  { name: "Ajuste de válvulas", description: "Verificación y ajuste de la holgura según las especificaciones del motor." },
  { name: "Mantenimiento general", description: "Conjunto de revisiones y servicios definidos por el taller para cada motocicleta." },
];

const fixtureReplacements = [
  "PB-MAINT-FIXTURE Servicio preventivo",
  "PB-MAINT-FIXTURE Revisión general",
  "PB-MAINT-FIXTURE Ajuste registrado",
] as const;

function assertLocalTarget(): void {
  const host = (process.env.DB_HOST ?? "").trim().toLowerCase();
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    throw new Error("El catálogo solo puede cargarse en una base local.");
  }
}

async function main(): Promise<void> {
  assertLocalTarget();
  const connection = await pool.getConnection();
  let inserted = 0;
  let updated = 0;
  let renamed = 0;

  try {
    await connection.beginTransaction();
    const [databaseRows] = await connection.query<Array<RowDataPacket & { databaseName: string }>>(
      "SELECT DATABASE() AS databaseName",
    );
    const databaseName = databaseRows[0]?.databaseName;
    if (!databaseName) throw new Error("No hay una base seleccionada.");

    for (const [index, fixtureName] of fixtureReplacements.entries()) {
      const replacement = catalog[index];
      if (!replacement) continue;
      const [targetRows] = await connection.execute<ServiceRow[]>(
        "SELECT SEIdService, SEName FROM SERVICES WHERE SEName = ? LIMIT 1",
        [replacement.name],
      );
      if (targetRows.length > 0) continue;
      const [fixtureRows] = await connection.execute<ServiceRow[]>(
        "SELECT SEIdService, SEName FROM SERVICES WHERE SEName = ? LIMIT 1 FOR UPDATE",
        [fixtureName],
      );
      const fixture = fixtureRows[0];
      if (!fixture) continue;
      await connection.execute(
        "UPDATE SERVICES SET SEName = ?, SEDescription = ?, SEState = 1 WHERE SEIdService = ?",
        [replacement.name, replacement.description, fixture.SEIdService],
      );
      renamed += 1;
    }

    for (const service of catalog) {
      const [rows] = await connection.execute<ServiceRow[]>(
        "SELECT SEIdService, SEName FROM SERVICES WHERE SEName = ? LIMIT 1 FOR UPDATE",
        [service.name],
      );
      const existing = rows[0];
      if (existing) {
        await connection.execute(
          "UPDATE SERVICES SET SEDescription = ?, SEState = 1 WHERE SEIdService = ?",
          [service.description, existing.SEIdService],
        );
        updated += 1;
      } else {
        const [result] = await connection.execute<ResultSetHeader>(
          "INSERT INTO SERVICES (SEName, SEDescription, SEMilesRecom, SETimeRecom, SEPriceRef, SEState, SEDetails) VALUES (?, ?, NULL, NULL, NULL, 1, NULL)",
          [service.name, service.description],
        );
        if (result.affectedRows !== 1) throw new Error("No se pudo insertar un servicio.");
        inserted += 1;
      }
    }

    await connection.commit();
    console.log(`Catálogo actualizado en ${databaseName}: ${inserted} insertados, ${updated} actualizados y ${renamed} fixtures convertidos.`);
  } catch (error: unknown) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Error desconocido";
  console.error(`No se pudo cargar el catálogo: ${message}`);
  process.exitCode = 1;
});

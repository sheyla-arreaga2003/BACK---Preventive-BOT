import dotenv from "dotenv";
import crypto from "node:crypto";
import mysql, { type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

dotenv.config({ quiet: true });

const TAG = "PB-MAINT-FIXTURE";
const SERIES = "MTFIX26";
const USER_EMAIL = "mantenimiento.fixture@example.invalid";
const EMAILS = [
  "mantenimiento.uno@example.invalid",
  "mantenimiento.dos@example.invalid",
  "mantenimiento.tres@example.invalid",
] as const;
const SERVICE_NAMES = [
  `${TAG} Servicio preventivo`,
  `${TAG} Revisión general`,
  `${TAG} Ajuste registrado`,
] as const;

interface CountRow extends RowDataPacket { total: number }
interface IdRow extends RowDataPacket { id: number }
interface Counts {
  users: number;
  customers: number;
  motorcycles: number;
  services: number;
  maintenances: number;
  details: number;
}

type SqlValue = string | number | null;

const EXPECTED: Counts = { users: 1, customers: 3, motorcycles: 4, services: 3, maintenances: 6, details: 7 };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable requerida ${name}.`);
  return value;
}

async function oneCount(
  connection: mysql.Connection,
  query: string,
  parameters: readonly SqlValue[],
): Promise<number> {
  const [rows] = await connection.execute<CountRow[]>(query, [...parameters]);
  return rows[0]?.total ?? 0;
}

async function counts(connection: mysql.Connection): Promise<Counts> {
  const emailSlots = EMAILS.map(() => "?").join(", ");
  const serviceSlots = SERVICE_NAMES.map(() => "?").join(", ");
  return {
    users: await oneCount(connection, "SELECT COUNT(*) AS total FROM USERS WHERE USEmail = ?", [USER_EMAIL]),
    customers: await oneCount(connection, `SELECT COUNT(*) AS total FROM CUSTOMER WHERE CUMail IN (${emailSlots})`, EMAILS),
    motorcycles: await oneCount(connection, "SELECT COUNT(*) AS total FROM MOTORCYCLES WHERE MOSerieInvoice = ?", [SERIES]),
    services: await oneCount(connection, `SELECT COUNT(*) AS total FROM SERVICES WHERE SEName IN (${serviceSlots})`, SERVICE_NAMES),
    maintenances: await oneCount(connection, "SELECT COUNT(*) AS total FROM MAINTENANCE WHERE MAObservations LIKE ?", [`${TAG}%`]),
    details: await oneCount(connection, `SELECT COUNT(*) AS total FROM DETAIL_MAINTENANCE DM INNER JOIN MAINTENANCE MA ON MA.MAMaintenance = DM.MAMaintenance WHERE MA.MAObservations LIKE ?`, [`${TAG}%`]),
  };
}

function complete(value: Counts): boolean {
  return Object.entries(EXPECTED).every(([key, expected]) => value[key as keyof Counts] === expected);
}

async function insertId(
  connection: mysql.Connection,
  query: string,
  parameters: readonly SqlValue[],
): Promise<number> {
  const [result] = await connection.execute<ResultSetHeader>(query, [...parameters]);
  return result.insertId;
}

function existingId(values: readonly number[], index: number, resource: string): number {
  const value = values[index];
  if (value === undefined) throw new Error(`No fue posible crear ${resource}.`);
  return value;
}

async function main(): Promise<void> {
  const host = required("DB_HOST").toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("La carga solo está permitida en una base MySQL local.");
  }
  const database = required("DB_NAME");
  const connection = await mysql.createConnection({
    host,
    port: Number(process.env.DB_PORT) || 3306,
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    database,
  });

  try {
    const [databaseRows] = await connection.query<Array<RowDataPacket & { name: string }>>("SELECT DATABASE() AS name");
    const actualDatabase = databaseRows[0]?.name;
    if (!actualDatabase || actualDatabase.toLowerCase() !== database.toLowerCase()) {
      throw new Error("La conexión no utiliza la base configurada.");
    }
    const existing = await counts(connection);
    if (complete(existing)) {
      console.log(`Base local: ${actualDatabase}`);
      console.log("Los fixtures ya estaban completos; no se insertaron duplicados.");
      console.log(JSON.stringify(existing));
      return;
    }
    if (Object.values(existing).some((value) => value > 0)) {
      throw new Error("Se detectó una carga parcial. No se insertó ni sobrescribió información.");
    }

    await connection.beginTransaction();
    try {
      const [roles] = await connection.execute<IdRow[]>(
        "SELECT ROIdRol AS id FROM ROL WHERE ROName = ? LIMIT 1",
        ["Admin"],
      );
      const roleId = roles[0]?.id;
      if (!roleId) throw new Error("No existe el rol administrativo requerido para el usuario técnico de pruebas.");
      const randomPasswordHash = crypto
        .createHash("sha256")
        .update(crypto.randomBytes(48))
        .digest("hex");
      const userId = await insertId(
        connection,
        "INSERT INTO USERS (USName, ROIdRol, USLastName, USEmail, USPhone, USPassword) VALUES (?, ?, ?, ?, ?, ?)",
        ["PB", roleId, "Maintenance Fixture", USER_EMAIL, null, randomPasswordHash],
      );

      const customerData = [
        ["Marina", "Demostración", "9900000000001", "90000001", EMAILS[0], "Dirección ficticia zona uno", "MTFIX000001"],
        ["Daniel", "Demostración", "9900000000002", "90000002", EMAILS[1], "Dirección ficticia zona dos", "MTFIX000002"],
        ["Lucía", "Demostración", "9900000000003", "90000003", EMAILS[2], "Dirección ficticia zona tres", "MTFIX000003"],
      ] as const;
      const customerIds: number[] = [];
      for (const row of customerData) {
        customerIds.push(await insertId(connection, `INSERT INTO CUSTOMER (CUName,CULastName,CUDPI,CUPhone,CUMail,CUAddress,CUFregister,CUState,CUNIT) VALUES (?,?,?,?,?,?,'2026-01-05 09:00:00',1,?)`, row));
      }

      const motorcycleData = [
        [existingId(customerIds, 0, "el primer cliente ficticio"), "TSTMT001", "Honda", "CB125F", "2025", "Rojo", "125", "VIN-MTFIX-0001", "1250", "CH-MTFIX-0001", "00000001"],
        [existingId(customerIds, 0, "el primer cliente ficticio"), "TSTMT002", "Yamaha", "FZ", "2024", "Azul", "150", "VIN-MTFIX-0002", "980", "CH-MTFIX-0002", "00000002"],
        [existingId(customerIds, 1, "el segundo cliente ficticio"), "TSTMT003", "Suzuki", "Gixxer", "2025", "Negro", null, "VIN-MTFIX-0003", null, null, "00000003"],
        [existingId(customerIds, 2, "el tercer cliente ficticio"), "TSTMT004", "Bajaj", "Pulsar 200", "2026", "Gris", "200", "VIN-MTFIX-0004", "0", "CH-MTFIX-0004", "00000004"],
      ] as const;
      const motorcycleIds: number[] = [];
      for (const row of motorcycleData) {
        motorcycleIds.push(await insertId(connection, `INSERT INTO MOTORCYCLES (CUIdCustomer,MOPlate,MOBrand,MOModel,MOYear,MOColor,MOCilindraje,MOVin,MOMiles,MOFRegister,MOChassis,MOState,MOSerieInvoice,MONumberInvoice) VALUES (?,?,?,?,?,?,?,?,?,'2026-01-10 10:00:00',?,1,?,?)`, [...row.slice(0, 10), SERIES, row[10]]));
      }

      const serviceData = [
        [SERVICE_NAMES[0], "Servicio preventivo ficticio para pruebas visuales"],
        [SERVICE_NAMES[1], "Revisión general ficticia de componentes registrados"],
        [SERVICE_NAMES[2], "Ajuste ficticio registrado durante el mantenimiento"],
      ] as const;
      const serviceIds: number[] = [];
      for (const row of serviceData) {
        serviceIds.push(await insertId(connection, `INSERT INTO SERVICES (SEName,SEDescription,SEMilesRecom,SETimeRecom,SEPriceRef,SEState,SEDetails) VALUES (?,?,NULL,NULL,NULL,1,NULL)`, row));
      }

      const maintenanceData = [
        [existingId(motorcycleIds, 0, "la primera motocicleta ficticia"), "2026-09-28", "1250", "2500", "2027-03-28"],
        [existingId(motorcycleIds, 0, "la primera motocicleta ficticia"), "2026-06-15", "980", "1500", "2026-10-15"],
        [existingId(motorcycleIds, 0, "la primera motocicleta ficticia"), "2026-02-10", "500", null, null],
        [existingId(motorcycleIds, 1, "la segunda motocicleta ficticia"), "2026-08-20", "980", "1800", "2027-02-20"],
        [existingId(motorcycleIds, 1, "la segunda motocicleta ficticia"), "2026-03-12", null, null, null],
        [existingId(motorcycleIds, 2, "la tercera motocicleta ficticia"), "2026-07-05", null, "1200", null],
      ] as const;
      const maintenanceIds: number[] = [];
      for (const [index, row] of maintenanceData.entries()) {
        maintenanceIds.push(await insertId(connection, `INSERT INTO MAINTENANCE (MOIdMoto,USId,MADate,MAMiles,MAObservations,MANextMiles,MANextDate) VALUES (?,?,?,?,?,?,?)`, [row[0], userId, row[1], row[2], `${TAG} registro ${index + 1}`, row[3], row[4]]));
      }

      const detailData = [[0,0],[0,1],[1,0],[1,2],[3,1],[4,2],[5,0]] as const;
      for (const [maintenanceIndex, serviceIndex] of detailData) {
        const maintenanceId = maintenanceIds[maintenanceIndex];
        const serviceId = serviceIds[serviceIndex];
        if (maintenanceId === undefined || serviceId === undefined) {
          throw new Error("No fue posible relacionar los fixtures de mantenimiento y servicios.");
        }
        await connection.execute(
          "INSERT INTO DETAIL_MAINTENANCE (MAMaintenance,SEIdService,SEAmount) VALUES (?,?,?)",
          [maintenanceId, serviceId, ""],
        );
      }
      const inserted = await counts(connection);
      if (!complete(inserted)) throw new Error("La verificación final no coincide con lo esperado.");
      await connection.commit();
      console.log(`Base local: ${actualDatabase}`);
      console.log("Fixtures de mantenimiento insertados correctamente.");
      console.log(JSON.stringify(inserted));
    } catch (error: unknown) {
      await connection.rollback();
      throw error;
    }
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error(`No se cargaron fixtures: ${error instanceof Error ? error.message : "Error desconocido"}`);
  process.exitCode = 1;
});

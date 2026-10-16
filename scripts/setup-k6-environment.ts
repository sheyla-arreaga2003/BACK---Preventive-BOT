import crypto from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import mysql, { type RowDataPacket } from "mysql2/promise";

dotenv.config({ path: ".env", quiet: true });

const TEST_DATABASE = "preventive_bot_k6_test";
const TEST_REDIS_PREFIX = "preventive-bot:test:k6:";
const TEST_PORT = 3100;
const ADMIN_EMAIL = "k6.admin@preventive-bot.test";
const REQUIRED_TABLES = ["ROL", "USERS", "CUSTOMER", "MOTORCYCLES"] as const;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta ${name} en el entorno local.`);
  return value;
}

function quoteIdentifier(value: string): string {
  return `\`${value.replaceAll("`", "``")}\``;
}

function dotenvValue(value: string): string {
  return JSON.stringify(value);
}

interface DatabaseRow extends RowDataPacket {
  SCHEMA_NAME: string;
}

interface TableRow extends RowDataPacket {
  TABLE_NAME: string;
}

interface CreateTableRow extends RowDataPacket {
  "Create Table": string;
}

interface CountRow extends RowDataPacket {
  total: number;
}

interface IdRow extends RowDataPacket {
  id: number;
}

async function main(): Promise<void> {
  const sourceDatabase = required("DB_NAME");
  if (sourceDatabase === TEST_DATABASE) {
    throw new Error("La base habitual y la base de k6 no pueden ser la misma.");
  }

  const host = required("DB_HOST");
  if (!["127.0.0.1", "localhost", "::1"].includes(host.toLowerCase())) {
    throw new Error("El aprovisionamiento de k6 solo admite MySQL local.");
  }

  const connection = await mysql.createConnection({
    host,
    port: Number(process.env.DB_PORT || 3306),
    user: required("DB_USER"),
    password: process.env.DB_PASSWORD ?? "",
    multipleStatements: false,
  });

  const adminPassword = crypto.randomBytes(24).toString("base64url");
  const jwtSecret = crypto.randomBytes(48).toString("base64url");
  let createdDatabase = false;

  try {
    const [databases] = await connection.execute<DatabaseRow[]>(
      "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?",
      [TEST_DATABASE],
    );

    if (databases.length === 0) {
      await connection.query(
        `CREATE DATABASE ${quoteIdentifier(TEST_DATABASE)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
      );
      createdDatabase = true;
    }

    const [sourceTables] = await connection.execute<TableRow[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?, ?, ?)`,
      [sourceDatabase, ...REQUIRED_TABLES],
    );
    const availableSourceTables = new Set(sourceTables.map((row) => row.TABLE_NAME.toUpperCase()));
    for (const table of REQUIRED_TABLES) {
      if (!availableSourceTables.has(table)) throw new Error(`La tabla ${table} no existe en el esquema de referencia.`);
    }

    await connection.query(`USE ${quoteIdentifier(TEST_DATABASE)}`);
    const [testTables] = await connection.execute<TableRow[]>(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?, ?, ?, ?)`,
      [TEST_DATABASE, ...REQUIRED_TABLES],
    );
    const availableTestTables = new Set(testTables.map((row) => row.TABLE_NAME.toUpperCase()));

    for (const table of REQUIRED_TABLES) {
      if (availableTestTables.has(table)) continue;
      const [rows] = await connection.query<CreateTableRow[]>(
        `SHOW CREATE TABLE ${quoteIdentifier(sourceDatabase)}.${quoteIdentifier(table)}`,
      );
      const statement = rows[0]?.["Create Table"];
      if (!statement) throw new Error(`No se pudo leer la estructura de ${table}.`);
      await connection.query(statement);
    }

    await connection.beginTransaction();
    try {
      const [roles] = await connection.execute<IdRow[]>(
        "SELECT ROIdRol AS id FROM ROL WHERE ROName = ? LIMIT 1",
        ["Admin"],
      );
      let roleId = roles[0]?.id;
      if (!roleId) {
        const [result] = await connection.execute<mysql.ResultSetHeader>(
          "INSERT INTO ROL (ROName, RODescripcion) VALUES (?, ?)",
          ["Admin", "Administrador ficticio para pruebas k6"],
        );
        roleId = result.insertId;
      }

      const [admins] = await connection.execute<IdRow[]>(
        "SELECT USId AS id FROM USERS WHERE USEmail = ? LIMIT 1",
        [ADMIN_EMAIL],
      );
      if (admins.length > 0) {
        throw new Error("La base de k6 ya contiene el administrador esperado; no se reemplazó su contraseña.");
      }

      await connection.execute(
        `INSERT INTO USERS (USName, ROIdRol, USLastName, USEmail, USPhone, USPassword)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          "Administrador",
          roleId,
          "Prueba K6",
          ADMIN_EMAIL,
          "00000000",
          crypto.createHash("sha256").update(adminPassword).digest("hex"),
        ],
      );

      for (let index = 1; index <= 24; index += 1) {
        const suffix = String(index).padStart(2, "0");
        const [customerResult] = await connection.execute<mysql.ResultSetHeader>(
          `INSERT INTO CUSTOMER
             (CUName, CULastName, CUDPI, CUPhone, CUMail, CUAddress, CUState, CUNIT)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `Cliente ${suffix}`,
            "Ficticio K6",
            `90000000000${suffix}`,
            `550000${suffix}`,
            `cliente.${suffix}@preventive-bot.test`,
            `Dirección ficticia ${suffix}`,
            1,
            `K6NIT${suffix}`,
          ],
        );

        const plate = index === 1 ? "" : index === 2 ? "   " : `K6${String(index).padStart(4, "0")}`;
        await connection.execute(
          `INSERT INTO MOTORCYCLES
             (CUIdCustomer, MOPlate, MOBrand, MOModel, MOYear, MOColor, MOCilindraje,
              MOVin, MOMiles, MOChassis, MOState, MOSerieInvoice, MONumberInvoice)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            customerResult.insertId,
            plate,
            "Marca Prueba",
            `Modelo K6 ${suffix}`,
            "2026",
            "Gris",
            "150",
            `K6VIN${String(index).padStart(12, "0")}`,
            String(1000 + index),
            `K6CH${String(index).padStart(8, "0")}`,
            1,
            `K6S${String(index).padStart(6, "0")}`,
            `K6F${String(index).padStart(6, "0")}`,
          ],
        );
      }

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }

    const redisUrl = process.env.REDIS_URL?.trim() || "redis://localhost:6379";
    const environment = [
      `PORT=${TEST_PORT}`,
      `JWT_SECRET=${dotenvValue(jwtSecret)}`,
      `REDIS_URL=${dotenvValue(redisUrl)}`,
      `REDIS_KEY_PREFIX=${TEST_REDIS_PREFIX}`,
      `DB_HOST=${dotenvValue(host)}`,
      `DB_PORT=${Number(process.env.DB_PORT || 3306)}`,
      `DB_USER=${dotenvValue(required("DB_USER"))}`,
      `DB_PASSWORD=${dotenvValue(process.env.DB_PASSWORD ?? "")}`,
      `DB_NAME=${TEST_DATABASE}`,
      "OPENAI_API_KEY=k6-disabled",
      "OPENAI_MODEL=k6-disabled",
      "CHATBOT_RAG_ENABLED=false",
      "REMINDER_WORKER_ENABLED=false",
      "",
    ].join("\n");
    const credentials = [
      `K6_TEST_EMAIL=${dotenvValue(ADMIN_EMAIL)}`,
      `K6_TEST_PASSWORD=${dotenvValue(adminPassword)}`,
      `BASE_URL=http://127.0.0.1:${TEST_PORT}`,
      "",
    ].join("\n");

    const root = process.cwd();
    const environmentPath = path.join(root, ".env.k6.local");
    const credentialsPath = path.join(root, ".env.k6.credentials.local");
    await writeFile(environmentPath, environment, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await writeFile(credentialsPath, credentials, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(environmentPath, 0o600);
    await chmod(credentialsPath, 0o600);

    const [clientCounts] = await connection.execute<CountRow[]>("SELECT COUNT(*) AS total FROM CUSTOMER");
    const [motorcycleCounts] = await connection.execute<CountRow[]>("SELECT COUNT(*) AS total FROM MOTORCYCLES");
    const [pendingCounts] = await connection.execute<CountRow[]>(
      "SELECT COUNT(*) AS total FROM MOTORCYCLES WHERE MOPlate IS NULL OR TRIM(MOPlate) = ''",
    );
    console.log(`Base preparada: ${TEST_DATABASE}${createdDatabase ? " (creada)" : ""}.`);
    console.log(`Clientes ficticios: ${clientCounts[0]?.total ?? 0}.`);
    console.log(`Motocicletas ficticias: ${motorcycleCounts[0]?.total ?? 0}.`);
    console.log(`Motocicletas sin placa registrada: ${pendingCounts[0]?.total ?? 0}.`);
    console.log("Archivos locales creados con permisos 600; no se mostraron credenciales.");
  } finally {
    await connection.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "No se pudo preparar el entorno k6.");
  process.exitCode = 1;
});

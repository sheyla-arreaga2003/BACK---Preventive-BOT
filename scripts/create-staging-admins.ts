import { stdin } from "node:process";
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { hash, verify } from "@node-rs/argon2";

export const ARGON2_OPTIONS = Object.freeze({
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

export const AUTHORIZED = Object.freeze({
  projectId: "1ff8317e-f21b-4266-83a6-2a133b890cef",
  environmentId: "96107c3b-b128-4044-8079-3017fd2586e2",
  serviceId: "cf6abb52-944c-46d3-8b08-090fd81e4860",
});

export const ADMINISTRATORS = Object.freeze([
  { name: "Alex", lastName: "Lopez", email: "alexlopfer07@gmail.com", phone: "48096180" },
  { name: "Usuario", lastName: "uno", email: "xelamototec@gmail.com", phone: "54520327" },
  { name: "Jaime", lastName: "Reyna", email: "jaimereyna81@icloud.com", phone: "52703149" },
] as const);

export const SEALED_HASH_VARIABLES = Object.freeze([
  "STAGING_ADMIN_PASSWORD_HASH_1",
  "STAGING_ADMIN_PASSWORD_HASH_2",
  "STAGING_ADMIN_PASSWORD_HASH_3",
] as const);

const REQUIRED_COLUMNS = ["USId", "USName", "ROIdRol", "USLastName", "USEmail", "USPhone", "USPassword"];
const LOCK_NAME = "preventive-bot:staging-admin-batch-v1";

export type BatchResult =
  | { status: "created"; ids: number[] }
  | { status: "already_exists"; emails: string[] }
  | { status: "preflight_failed"; reason: string }
  | { status: "insert_failed"; committed: false }
  | { status: "verification_failed"; committed: true };

export function decodePasswords(input: Buffer): [string, string, string, string, string, string] {
  const parts = input.toString("utf8").split("\0");
  if (parts.length !== 7 || parts[6] !== "") throw new Error("Entrada de contraseñas inválida.");
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!, parts[4]!, parts[5]!];
}

export function isAuthorizedStaging(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.NODE_ENV === "production"
    && environment.RAILWAY_PROJECT_ID === AUTHORIZED.projectId
    && environment.RAILWAY_ENVIRONMENT_ID === AUTHORIZED.environmentId
    && environment.RAILWAY_SERVICE_ID === AUTHORIZED.serviceId;
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

function number(value: unknown): number { return Number(value ?? 0); }

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function makeHashes(passwords: string[]): Promise<string[]> {
  if (passwords.some((password) => password.length < 12)) {
    throw new Error("Cada contraseña debe tener al menos 12 caracteres.");
  }
  if (new Set(passwords).size !== passwords.length) throw new Error("Las contraseñas deben ser individuales.");
  const hashes: string[] = [];
  for (const password of passwords) {
    const generated = await hash(password, ARGON2_OPTIONS);
    if (!/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/.test(generated) || !(await verify(generated, password))) {
      throw new Error("No se pudo validar un hash Argon2id.");
    }
    hashes.push(generated);
  }
  return hashes;
}

export function readSealedHashes(environment: NodeJS.ProcessEnv = process.env): string[] {
  if (environment.STAGING_ADMIN_BATCH_HASH_MODE !== "sealed") {
    throw new Error("Modo de hashes sellados no confirmado.");
  }
  const hashes = SEALED_HASH_VARIABLES.map((name) => environment[name] ?? "");
  if (hashes.some((value) => !/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[^$]+\$[^$]+$/.test(value))) {
    throw new Error("Falta un hash Argon2id compatible.");
  }
  if (new Set(hashes).size !== hashes.length) throw new Error("Los hashes deben ser individuales.");
  return hashes;
}

export async function createStagingAdministrators(pool: Pool, passwordHashes: string[]): Promise<BatchResult> {
  if (!isAuthorizedStaging() || process.env.STAGING_ADMIN_BATCH_ENABLED !== "true") {
    return { status: "preflight_failed", reason: "staging_guard_not_confirmed" };
  }
  if (passwordHashes.length !== ADMINISTRATORS.length) return { status: "preflight_failed", reason: "hash_count" };

  const connection = await pool.getConnection();
  let transactionStarted = false;
  let committed = false;
  let lockAcquired = false;
  try {
    const [columnRows] = await connection.execute<RowDataPacket[]>(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
      ["USERS"],
    );
    const columns = columnRows.map((row) => String(row.COLUMN_NAME));
    if (REQUIRED_COLUMNS.some((column) => !columns.includes(column))) {
      return { status: "preflight_failed", reason: "missing_users_columns" };
    }

    const [roleRows] = await connection.execute<RowDataPacket[]>("SELECT ROIdRol, ROName FROM ROL WHERE ROIdRol=?", [1]);
    if (roleRows.length !== 1 || roleRows[0]?.ROName !== "Admin") return { status: "preflight_failed", reason: "admin_role_not_confirmed" };

    const [uniqueRows] = await connection.execute<RowDataPacket[]>(
      "SELECT NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
      ["USERS", "USEmail"],
    );
    if (!uniqueRows.some((row) => number(row.NON_UNIQUE) === 0)) return { status: "preflight_failed", reason: "email_unique_constraint_not_confirmed" };

    const placeholders = ADMINISTRATORS.map(() => "?").join(",");
    const emails = ADMINISTRATORS.map((admin) => admin.email);
    const [existingRows] = await connection.execute<RowDataPacket[]>(
      `SELECT USEmail FROM USERS WHERE LOWER(USEmail) IN (${placeholders})`, emails,
    );
    if (existingRows.length > 0) return { status: "already_exists", emails: existingRows.map((row) => String(row.USEmail)) };

    const [lockRows] = await connection.execute<RowDataPacket[]>("SELECT GET_LOCK(?, 10) AS acquired", [LOCK_NAME]);
    lockAcquired = number(lockRows[0]?.acquired) === 1;
    if (!lockAcquired) return { status: "insert_failed", committed: false };

    await connection.beginTransaction();
    transactionStarted = true;
    const [duplicateRows] = await connection.execute<RowDataPacket[]>(
      `SELECT USEmail FROM USERS WHERE LOWER(USEmail) IN (${placeholders}) FOR UPDATE`, emails,
    );
    if (duplicateRows.length > 0) {
      await connection.rollback();
      transactionStarted = false;
      return { status: "already_exists", emails: duplicateRows.map((row) => String(row.USEmail)) };
    }

    const ids: number[] = [];
    for (const [index, admin] of ADMINISTRATORS.entries()) {
      const [result] = await (connection.execute as unknown as (sql: string, values: unknown[]) => Promise<[ResultSetHeader, unknown]>) (
        "INSERT INTO USERS (USName, ROIdRol, USLastName, USEmail, USPhone, USPassword) VALUES (?, ?, ?, ?, ?, ?)",
        [admin.name, 1, admin.lastName, admin.email, admin.phone, passwordHashes[index]],
      );
      ids.push(number((result as { insertId?: unknown }).insertId));
    }
    await connection.commit();
    transactionStarted = false;
    committed = true;

    const [verificationRows] = await connection.execute<RowDataPacket[]>(
      `SELECT USId, USName, USLastName, USEmail, USPhone, ROIdRol, USPassword LIKE '$argon2id$%' AS isArgon2id
       FROM USERS WHERE USId IN (${ids.map(() => "?").join(",")})`, ids,
    );
    const verified = verificationRows.length === ADMINISTRATORS.length
      && ADMINISTRATORS.every((admin) => verificationRows.some((row) => row.USEmail === admin.email && number(row.ROIdRol) === 1 && Boolean(row.isArgon2id)));
    return verified ? { status: "created", ids } : { status: "verification_failed", committed: true };
  } catch {
    if (transactionStarted && !committed) await connection.rollback().catch(() => undefined);
    return committed ? { status: "verification_failed", committed: true } : { status: "insert_failed", committed: false };
  } finally {
    if (lockAcquired) await connection.execute("SELECT RELEASE_LOCK(?)", [LOCK_NAME]).catch(() => undefined);
    connection.release();
  }
}

async function main(): Promise<void> {
  if (process.env.CONFIRM_STAGING_ADMIN_BATCH !== "CREATE_THREE_ADMINS") throw new Error("Falta confirmación explícita.");
  if (!isAuthorizedStaging() || process.env.STAGING_ADMIN_BATCH_ENABLED !== "true") throw new Error("Entorno staging no autorizado.");
  const hashes = process.env.STAGING_ADMIN_BATCH_HASH_MODE === "sealed"
    ? readSealedHashes()
    : await (async () => {
      const [a, aConfirm, b, bConfirm, c, cConfirm] = decodePasswords(await readStdin());
      if (a !== aConfirm || b !== bConfirm || c !== cConfirm) throw new Error("Las contraseñas no coinciden.");
      return makeHashes([a, b, c]);
    })();
  const dbHost = process.env.DB_HOST;
  const dbUser = process.env.DB_USER;
  const dbPassword = process.env.DB_PASSWORD;
  const dbName = process.env.DB_NAME;
  if (!dbHost || !dbUser || !dbPassword || !dbName) throw new Error("Faltan variables de conexión de staging.");
  const pool = mysql.createPool({ host: dbHost, port: Number(process.env.DB_PORT || 3306), user: dbUser, password: dbPassword, database: dbName, connectionLimit: 1 });
  const result = await createStagingAdministrators(pool, hashes);
  await pool.end();
  if (result.status !== "created") throw new Error(`Resultado: ${result.status}`);
  console.log("Administradores creados y verificados.");
}

if (/(^|\/)create-staging-admins\.(ts|js)$/.test(process.argv[1] ?? "")) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "No se pudo completar la operación."); process.exitCode = 1; });
}

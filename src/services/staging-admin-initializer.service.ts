import { isArgon2idHash } from "./password.service.js";

export const AUTHORIZED_STAGING_PROJECT_ID = "1ff8317e-f21b-4266-83a6-2a133b890cef";
export const AUTHORIZED_STAGING_ENVIRONMENT_ID = "96107c3b-b128-4044-8079-3017fd2586e2";
export const AUTHORIZED_BACKEND_SERVICE_ID = "cf6abb52-944c-46d3-8b08-090fd81e4860";

const ADMIN_EMAIL = "sheyla.valle2003@gmail.com";
const ADMIN_NAME = "Shey";
const ADMIN_LAST_NAME = "Arreaga";
const ADMIN_PHONE = "30216167";
const ADMIN_ROLE_ID = 1;
const ADMIN_ROLE_NAME = "Admin";
const ADMIN_LOCK_NAME = "preventive-bot:staging-admin-init";
const REQUIRED_COLUMNS = [
  "USId",
  "USName",
  "ROIdRol",
  "USLastName",
  "USEmail",
  "USPhone",
  "USPassword",
  "USFregister",
  "USLastLoginAt",
] as const;

type QueryResult = [rows: unknown, fields?: unknown];

export interface InitializerConnection {
  execute(sql: string, values?: unknown[]): Promise<QueryResult>;
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

export interface InitializerPool {
  getConnection(): Promise<InitializerConnection>;
}

export interface StagingAdminInitializerConfig {
  enabled: boolean;
  nodeEnvironment: string;
  railwayProjectId: string;
  railwayEnvironmentId: string;
  railwayServiceId: string;
  passwordHash: string;
}

export type StagingAdminInitResult =
  | { status: "skipped"; reason: "disabled" | "outside_staging" }
  | { status: "already_exists" }
  | { status: "created"; userId: number }
  | { status: "preflight_failed"; reason: string }
  | { status: "insert_failed"; committed: false }
  | { status: "verification_failed"; committed: true };

function isCompatibleArgon2idHash(value: string): boolean {
  if (!isArgon2idHash(value) || value.length > 255 || /\s/.test(value)) return false;
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return false;
  return match[1] === "19456"
    && match[2] === "2"
    && match[3] === "1"
    && (match[4]?.length ?? 0) >= 16
    && (match[5]?.length ?? 0) === 43;
}

function isExactStaging(config: StagingAdminInitializerConfig): boolean {
  return config.enabled
    && config.nodeEnvironment === "production"
    && config.railwayProjectId === AUTHORIZED_STAGING_PROJECT_ID
    && config.railwayEnvironmentId === AUTHORIZED_STAGING_ENVIRONMENT_ID
    && config.railwayServiceId === AUTHORIZED_BACKEND_SERVICE_ID;
}

function safeNumber(value: unknown): number {
  return Number(value ?? 0);
}

function rowsOf(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
}

export async function runStagingAdminInitializer(
  pool: InitializerPool,
  config: StagingAdminInitializerConfig,
): Promise<StagingAdminInitResult> {
  if (!config.enabled) return { status: "skipped", reason: "disabled" };
  if (!isExactStaging(config)) return { status: "skipped", reason: "outside_staging" };
  if (!isCompatibleArgon2idHash(config.passwordHash)) {
    return { status: "preflight_failed", reason: "invalid_argon2id_hash" };
  }

  const connection = await pool.getConnection();
  let transactionStarted = false;
  let committed = false;
  let lockAcquired = false;
  try {
    const [rawColumns] = await connection.execute(
      "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?",
      ["USERS"],
    );
    const columnNames = rowsOf(rawColumns).map((column) => String(column.COLUMN_NAME));
    const missingColumns = REQUIRED_COLUMNS.filter((column) => !columnNames.includes(column));
    if (missingColumns.length > 0) {
      return { status: "preflight_failed", reason: "missing_users_columns" };
    }

    const [rawRoleRows] = await connection.execute(
      "SELECT ROIdRol, ROName FROM ROL WHERE ROIdRol=?",
      [ADMIN_ROLE_ID],
    );
    const roleRows = rowsOf(rawRoleRows);
    if (roleRows.length !== 1 || roleRows[0]?.ROName !== ADMIN_ROLE_NAME) {
      return { status: "preflight_failed", reason: "admin_role_not_confirmed" };
    }

    const [rawUniqueRows] = await connection.execute(
      "SELECT NON_UNIQUE FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
      ["USERS", "USEmail"],
    );
    if (!rowsOf(rawUniqueRows).some((row) => safeNumber(row.NON_UNIQUE) === 0)) {
      return { status: "preflight_failed", reason: "email_unique_constraint_not_confirmed" };
    }

    const [rawEmailRows] = await connection.execute(
      "SELECT COUNT(*) AS total FROM USERS WHERE LOWER(USEmail)=LOWER(?)",
      [ADMIN_EMAIL],
    );
    const [rawAdminRows] = await connection.execute(
      "SELECT COUNT(*) AS total FROM USERS WHERE ROIdRol=?",
      [ADMIN_ROLE_ID],
    );
    if (safeNumber(rowsOf(rawEmailRows)[0]?.total) > 0 || safeNumber(rowsOf(rawAdminRows)[0]?.total) > 0) {
      return { status: "already_exists" };
    }

    const [rawLockRows] = await connection.execute(
      "SELECT GET_LOCK(?, 10) AS acquired",
      [ADMIN_LOCK_NAME],
    );
    lockAcquired = safeNumber(rowsOf(rawLockRows)[0]?.acquired) === 1;
    if (!lockAcquired) return { status: "insert_failed", committed: false };

    await connection.beginTransaction();
    transactionStarted = true;
    const [rawEmailRowsInTransaction] = await connection.execute(
      "SELECT USId FROM USERS WHERE LOWER(USEmail)=LOWER(?) FOR UPDATE",
      [ADMIN_EMAIL],
    );
    const [rawAdminRowsInTransaction] = await connection.execute(
      "SELECT USId FROM USERS WHERE ROIdRol=? FOR UPDATE",
      [ADMIN_ROLE_ID],
    );
    if (rowsOf(rawEmailRowsInTransaction).length > 0 || rowsOf(rawAdminRowsInTransaction).length > 0) {
      await connection.rollback();
      transactionStarted = false;
      return { status: "already_exists" };
    }

    const [insertResult] = await connection.execute(
      "INSERT INTO USERS (USName, ROIdRol, USLastName, USEmail, USPhone, USPassword) VALUES (?, ?, ?, ?, ?, ?)",
      [ADMIN_NAME, ADMIN_ROLE_ID, ADMIN_LAST_NAME, ADMIN_EMAIL, ADMIN_PHONE, config.passwordHash],
    );
    await connection.commit();
    transactionStarted = false;
    committed = true;

    const insertId = safeNumber((insertResult as { insertId?: unknown }).insertId);
    const [rawVerificationRows] = await connection.execute(
      "SELECT USId, USName, USLastName, USEmail, USPhone, ROIdRol, USPassword LIKE '$argon2id$%' AS isArgon2id FROM USERS WHERE USId=?",
      [insertId],
    );
    const verificationRows = rowsOf(rawVerificationRows);
    const verified = verificationRows.length === 1
      && safeNumber(verificationRows[0]?.USId) === insertId
      && verificationRows[0]?.USEmail === ADMIN_EMAIL
      && safeNumber(verificationRows[0]?.ROIdRol) === ADMIN_ROLE_ID
      && Boolean(verificationRows[0]?.isArgon2id);
    return verified
      ? { status: "created", userId: insertId }
      : { status: "verification_failed", committed: true };
  } catch {
    if (transactionStarted && !committed) await connection.rollback().catch(() => undefined);
    return committed
      ? { status: "verification_failed", committed: true }
      : { status: "insert_failed", committed: false };
  } finally {
    if (lockAcquired) await connection.execute("SELECT RELEASE_LOCK(?)", [ADMIN_LOCK_NAME]).catch(() => undefined);
    connection.release();
  }
}

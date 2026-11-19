import mysql from "mysql2/promise";
import { env } from "./env.js";

if (!["disabled", "preferred", "required"].includes(env.DB_SSL_MODE)) {
  throw new Error("DB_SSL_MODE must be disabled, preferred, or required");
}

const ssl = env.DB_SSL_MODE === "disabled"
  ? undefined
  : { rejectUnauthorized: env.DB_SSL_MODE === "required" };

const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: env.DB_CONNECTION_LIMIT,
  connectTimeout: env.DB_CONNECT_TIMEOUT_MS,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  waitForConnections: true,
  queueLimit: 0,
  timezone: env.DB_TIMEZONE,
  ...(ssl ? { ssl } : {}),
});

export default pool;

import type { RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import type {
  ActivityAvailableRow, ActivityCountRow, ActivityPage, ActivityPeriod, ActivityRow, ActivityTotalRow,
  ProfileRepository, UserProfileDetailsRow,
} from "../interfaces/profile.interface.js";

export class ProfileValidationError extends Error {}
export class ProfileNotFoundError extends Error {}

const GUATEMALA_OFFSET_HOURS = 6;

function dateInGuatemala(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addUtcDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function sqlUtcBoundary(localDate: string): string {
  return `${localDate} ${String(GUATEMALA_OFFSET_HOURS).padStart(2, "0")}:00:00.000`;
}

export function resolveActivityPeriod(from?: string, to?: string, now = new Date()): ActivityPeriod & { sqlFrom: string; sqlTo: string } {
  const today = dateInGuatemala(now);
  const defaultFrom = `${today.slice(0, 7)}-01`;
  const periodFrom = from ?? defaultFrom;
  const periodTo = to ?? today;
  if (!validDate(periodFrom) || !validDate(periodTo) || periodFrom > periodTo) {
    throw new ProfileValidationError("El período indicado no es válido");
  }
  const days = (Date.parse(`${periodTo}T00:00:00Z`) - Date.parse(`${periodFrom}T00:00:00Z`)) / 86_400_000;
  if (days > 366) throw new ProfileValidationError("El período no puede superar 366 días");
  return {
    from: periodFrom,
    to: periodTo,
    sqlFrom: sqlUtcBoundary(periodFrom),
    sqlTo: sqlUtcBoundary(addUtcDays(periodTo, 1)),
  };
}

const databaseRepository: ProfileRepository = {
  async getProfileDetails(userId) {
    const [rows] = await pool.execute<UserProfileDetailsRow[]>(`
      SELECT U.USId, U.USName, U.USLastName, U.USEmail, U.USPhone,
             DATE_FORMAT(U.USFregister, '%Y-%m-%d') AS USFregister,
             CASE WHEN U.USLastLoginAt IS NULL THEN NULL ELSE
               CONCAT(DATE_FORMAT(U.USLastLoginAt, '%Y-%m-%dT%H:%i:%s.'),
                      LEFT(DATE_FORMAT(U.USLastLoginAt, '%f'), 3), 'Z')
             END AS USLastLoginAt,
             U.ROIdRol, R.ROName
      FROM USERS U
      LEFT JOIN ROL R ON R.ROIdRol = U.ROIdRol
      WHERE U.USId = ?
      LIMIT 1
    `, [userId]);
    return rows[0] ?? null;
  },
  async getActivityCounts(userId, from, to) {
    const [rows] = await pool.execute<ActivityCountRow[]>(`
      SELECT UAEventType AS activityType, COUNT(*) AS total
      FROM USER_ACTIVITY
      WHERE USId = ? AND UACreatedAt >= ? AND UACreatedAt < ?
      GROUP BY UAEventType
    `, [userId, from, to]);
    return rows;
  },
  async getActivityAvailableFrom(userId) {
    const [rows] = await pool.execute<ActivityAvailableRow[]>(`
      SELECT DATE_FORMAT(CONVERT_TZ(MIN(UACreatedAt), '+00:00', '-06:00'), '%Y-%m-%d') AS availableFrom
      FROM USER_ACTIVITY
      WHERE USId = ?
    `, [userId]);
    return rows[0]?.availableFrom ?? null;
  },
  async getActivityTotal(userId, from, to) {
    const [rows] = await pool.execute<ActivityTotalRow[]>(`
      SELECT COUNT(*) AS total FROM USER_ACTIVITY
      WHERE USId = ? AND UACreatedAt >= ? AND UACreatedAt < ?
    `, [userId, from, to]);
    return Number(rows[0]?.total ?? 0);
  },
  async getActivityPage(userId, from, to, limit, offset) {
    const [rows] = await pool.query<ActivityRow[]>(`
      SELECT UAId, UAEventType, UAEntityType, UAEntityId,
             CONCAT(DATE_FORMAT(UACreatedAt, '%Y-%m-%dT%H:%i:%s.'),
                    LEFT(DATE_FORMAT(UACreatedAt, '%f'), 3), 'Z') AS UACreatedAt
      FROM USER_ACTIVITY
      WHERE USId = ? AND UACreatedAt >= ? AND UACreatedAt < ?
      ORDER BY UACreatedAt DESC, UAId DESC
      LIMIT ? OFFSET ?
    `, [userId, from, to, limit, offset]);
    return rows;
  },
};

function isoOrNull(value: Date | string | null): string | null {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

export function createProfileService(repository: ProfileRepository = databaseRepository) {
  async function activityPage(
    userId: number,
    page: number,
    pageSize: number,
    from?: string,
    to?: string,
  ): Promise<ActivityPage> {
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      throw new ProfileValidationError("La paginación no es válida");
    }
    const period = resolveActivityPeriod(from, to);
    const [total, rows] = await Promise.all([
      repository.getActivityTotal(userId, period.sqlFrom, period.sqlTo),
      repository.getActivityPage(userId, period.sqlFrom, period.sqlTo, pageSize, (page - 1) * pageSize),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.UAId,
        type: row.UAEventType,
        entityType: row.UAEntityType,
        entityId: row.UAEntityId,
        occurredAt: String(row.UACreatedAt),
      })),
      pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
      period: { from: period.from, to: period.to },
    };
  }

  async function overview(userId: number, from?: string, to?: string) {
    const period = resolveActivityPeriod(from, to);
    const [profile, counts, availableFrom, recent] = await Promise.all([
      repository.getProfileDetails(userId),
      repository.getActivityCounts(userId, period.sqlFrom, period.sqlTo),
      repository.getActivityAvailableFrom(userId),
      activityPage(userId, 1, 5, period.from, period.to),
    ]);
    if (!profile) throw new ProfileNotFoundError("Usuario no encontrado");
    const values = new Map(counts.map((row) => [row.activityType, Number(row.total)]));
    return {
      profile: {
        id: profile.USId,
        name: profile.USName,
        lastName: profile.USLastName,
        email: profile.USEmail,
        phone: profile.USPhone,
        role: profile.ROIdRol === null ? null : { id: profile.ROIdRol, name: profile.ROName },
        registeredAt: isoOrNull(profile.USFregister),
        lastLoginAt: isoOrNull(profile.USLastLoginAt),
      },
      stats: {
        clientsRegistered: values.get("CLIENT_CREATED") ?? 0,
        maintenancesRegistered: values.get("MAINTENANCE_CREATED") ?? 0,
        plateProcessesUpdated: values.get("PLATE_PROCESS_UPDATED") ?? 0,
      },
      recentActivity: recent.data,
      period: { from: period.from, to: period.to },
      activityAvailableFrom: availableFrom,
      historicalAttributionAvailable: false,
    };
  }

  return { overview, activityPage };
}

export const profileService = createProfileService();


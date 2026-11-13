import type { PoolConnection } from "mysql2/promise";
import type { AdminActivityType } from "../interfaces/profile.interface.js";

export async function recordAdminActivity(
  connection: PoolConnection,
  userId: number,
  eventType: AdminActivityType,
  entityType: string,
  entityId: number | string | null,
): Promise<void> {
  await connection.execute(
    `INSERT INTO USER_ACTIVITY
      (USId, UAEventType, UAEntityType, UAEntityId, UACreatedAt)
     VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [userId, eventType, entityType, entityId === null ? null : String(entityId)],
  );
}


import type { RowDataPacket } from "mysql2";

export type AdminActivityType =
  | "CLIENT_CREATED"
  | "CLIENT_UPDATED"
  | "MAINTENANCE_CREATED"
  | "PLATE_PROCESS_UPDATED";

export interface UserProfileDetailsRow extends RowDataPacket {
  USId: number;
  USName: string;
  USLastName: string;
  USEmail: string;
  USPhone: string | null;
  USFregister: Date | string | null;
  USLastLoginAt: Date | string | null;
  ROIdRol: number | null;
  ROName: string | null;
}

export interface ActivityCountRow extends RowDataPacket {
  activityType: AdminActivityType;
  total: number | string;
}

export interface ActivityTotalRow extends RowDataPacket {
  total: number | string;
}

export interface ActivityAvailableRow extends RowDataPacket {
  availableFrom: string | null;
}

export interface ActivityRow extends RowDataPacket {
  UAId: number;
  UAEventType: AdminActivityType;
  UAEntityType: string;
  UAEntityId: string | null;
  UACreatedAt: Date | string;
}

export interface ActivityPeriod {
  from: string;
  to: string;
}

export interface ActivityPage {
  data: Array<{
    id: number;
    type: AdminActivityType;
    entityType: string;
    entityId: string | null;
    occurredAt: string;
  }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  period: ActivityPeriod;
}

export interface ProfileRepository {
  getProfileDetails(userId: number): Promise<UserProfileDetailsRow | null>;
  getActivityCounts(userId: number, from: string, to: string): Promise<ActivityCountRow[]>;
  getActivityAvailableFrom(userId: number): Promise<string | null>;
  getActivityTotal(userId: number, from: string, to: string): Promise<number>;
  getActivityPage(userId: number, from: string, to: string, limit: number, offset: number): Promise<ActivityRow[]>;
}


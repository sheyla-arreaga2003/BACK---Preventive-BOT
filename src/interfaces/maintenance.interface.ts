import type { RowDataPacket } from "mysql2";

export interface MaintenanceInvoiceMotorcycleRow extends RowDataPacket {
  MOIdMoto: number;
}

export interface MaintenanceRecordRow extends RowDataPacket {
  MAMaintenance: number;
  MADate: string;
  MAMiles: string | null;
  MANextMiles: string | null;
  MANextDate: string | null;
}

export interface MaintenanceServiceRow extends RowDataPacket {
  MAMaintenance: number;
  SEName: string | null;
  SEDescription: string | null;
}

export interface MaintenanceCountRow extends RowDataPacket {
  total: number;
}
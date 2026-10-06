import type { RowDataPacket } from "mysql2";
import pool from "../config/database.js";

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

interface MaintenanceCountRow extends RowDataPacket {
  total: number;
}

export interface MaintenanceReadRepository {
  findMotorcyclesByInvoice(serieInvoice: string, numberInvoice: string): Promise<MaintenanceInvoiceMotorcycleRow[]>;
  countByMotorcycle(motorcycleId: number): Promise<number>;
  findPageByMotorcycle(
    motorcycleId: number,
    pageSize: number,
    offset: number,
  ): Promise<MaintenanceRecordRow[]>;
  findServicesByMaintenanceIds(maintenanceIds: readonly number[]): Promise<MaintenanceServiceRow[]>;
}

export interface MaintenanceInvoicePage {
  maintenances: Array<{
    date: string;
    mileage: string | null;
    nextMileage: string | null;
    nextDate: string | null;
    services: Array<{
      name: string;
      description: string;
    }>;
  }>;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export type MaintenanceInvoiceResult =
  | { status: "found"; data: MaintenanceInvoicePage }
  | { status: "not_found" }
  | { status: "ambiguous" };

const mysqlMaintenanceReadRepository: MaintenanceReadRepository = {
  async findMotorcyclesByInvoice(serieInvoice, numberInvoice) {
    const query = `
      SELECT MOIdMoto
      FROM MOTORCYCLES
      WHERE MOSerieInvoice = ?
        AND MONumberInvoice = ?
    `;
    const [rows] = await pool.execute<MaintenanceInvoiceMotorcycleRow[]>(query, [serieInvoice, numberInvoice]);
    return rows;
  },

  async countByMotorcycle(motorcycleId) {
    const query = `
      SELECT COUNT(*) AS total
      FROM MAINTENANCE
      WHERE MOIdMoto = ?
    `;
    const [rows] = await pool.execute<MaintenanceCountRow[]>(query, [motorcycleId]);
    return rows[0]?.total ?? 0;
  },

  async findPageByMotorcycle(motorcycleId, pageSize, offset) {
    const query = `
      SELECT
        MA.MAMaintenance,
        DATE_FORMAT(MA.MADate, '%Y-%m-%d') AS MADate,
        MA.MAMiles,
        MA.MANextMiles,
        MA.MANextDate
      FROM MAINTENANCE MA
      WHERE MA.MOIdMoto = ?
      ORDER BY MA.MADate DESC, MA.MAMaintenance DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await pool.query<MaintenanceRecordRow[]>(query, [motorcycleId, pageSize, offset]);
    return rows;
  },

  async findServicesByMaintenanceIds(maintenanceIds) {
    if (maintenanceIds.length === 0) return [];
    const placeholders = maintenanceIds.map(() => "?").join(", ");
    const query = `
      SELECT
        DM.MAMaintenance,
        SE.SEName,
        SE.SEDescription
      FROM DETAIL_MAINTENANCE DM
      LEFT JOIN SERVICES SE
        ON SE.SEIdService = DM.SEIdService
      WHERE DM.MAMaintenance IN (${placeholders})
      ORDER BY DM.MAMaintenance DESC, DM.DMIdDetail ASC
    `;
    const [rows] = await pool.execute<MaintenanceServiceRow[]>(query, [...maintenanceIds]);
    return rows;
  },
};

function validatePagination(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError("page must be a positive integer");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new RangeError("pageSize must be a positive integer no greater than 50");
  }
}

export function createMaintenanceInvoiceReader(repository: MaintenanceReadRepository) {
  return async function getMaintenancesByInvoice(
    serieInvoice: string,
    numberInvoice: string,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<MaintenanceInvoiceResult> {
    if (typeof serieInvoice !== "string" || serieInvoice.trim().length === 0) {
      throw new TypeError("serieInvoice must be a non-empty string");
    }
    if (typeof numberInvoice !== "string" || numberInvoice.trim().length === 0) {
      throw new TypeError("numberInvoice must be a non-empty string");
    }
    validatePagination(page, pageSize);

    const motorcycles = await repository.findMotorcyclesByInvoice(
      serieInvoice.trim(),
      numberInvoice.trim(),
    );
    if (motorcycles.length === 0) return { status: "not_found" };
    if (motorcycles.length > 1) return { status: "ambiguous" };

    const motorcycle = motorcycles[0];
    if (!motorcycle) return { status: "not_found" };

    const total = await repository.countByMotorcycle(motorcycle.MOIdMoto);
    const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
    const maintenanceRows = await repository.findPageByMotorcycle(
      motorcycle.MOIdMoto,
      pageSize,
      (page - 1) * pageSize,
    );
    const maintenanceIds = maintenanceRows.map((maintenance) => maintenance.MAMaintenance);
    const serviceRows = await repository.findServicesByMaintenanceIds(maintenanceIds);

    const servicesByMaintenance = new Map<number, MaintenanceInvoicePage["maintenances"][number]["services"]>();
    for (const service of serviceRows) {
      if (service.SEName === null || service.SEDescription === null) continue;
      const services = servicesByMaintenance.get(service.MAMaintenance) ?? [];
      services.push({ name: service.SEName, description: service.SEDescription });
      servicesByMaintenance.set(service.MAMaintenance, services);
    }

    return {
      status: "found",
      data: {
        maintenances: maintenanceRows.map((maintenance) => ({
          date: maintenance.MADate,
          mileage: maintenance.MAMiles,
          nextMileage: maintenance.MANextMiles,
          nextDate: maintenance.MANextDate,
          services: servicesByMaintenance.get(maintenance.MAMaintenance) ?? [],
        })),
        pagination: { page, pageSize, total, totalPages },
      },
    };
  };
}

export const getMaintenancesByInvoice = createMaintenanceInvoiceReader(mysqlMaintenanceReadRepository);

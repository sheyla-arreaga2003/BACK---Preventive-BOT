import type { MaintenanceInvoiceMotorcycleRow, MaintenanceRecordRow, MaintenanceServiceRow, MaintenanceCountRow } from "../interfaces/maintenance.interface.js";
import { findMotorcyclesByInvoice, countByMotorcycle, findPageByMotorcycle, findServicesByMaintenanceIds } from "./database.service.js";

export type {
  MaintenanceInvoiceMotorcycleRow,
  MaintenanceRecordRow,
  MaintenanceServiceRow,
} from "../interfaces/maintenance.interface.js";

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

function validatePagination(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 1) {
    throw new RangeError("page must be a positive integer");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new RangeError("pageSize must be a positive integer no greater than 50");
  }
}

const mysqlMaintenanceReadRepository: MaintenanceReadRepository = {
  findMotorcyclesByInvoice,
  countByMotorcycle,
  findPageByMotorcycle,
  findServicesByMaintenanceIds,
};

export function createMaintenanceInvoiceReader(
  repository: MaintenanceReadRepository = mysqlMaintenanceReadRepository,
) {
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

export const getMaintenancesByInvoice = createMaintenanceInvoiceReader();

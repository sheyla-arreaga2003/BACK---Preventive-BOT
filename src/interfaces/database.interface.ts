import type { ResultSetHeader, RowDataPacket } from "mysql2";

export interface UserRow extends RowDataPacket {
  USId: number;
  USName: string;
  USLastName: string;
  USEmail: string;
  USPhone: string | null;
  USPassword: string;
  ROIdRol: number | null;
}

export interface AuthenticatedUserRow extends RowDataPacket {
  USId: number;
  USName: string;
  USLastName: string;
  USEmail: string;
  USPhone: string | null;
  ROIdRol: number | null;
}

export interface MotorcycleLatestProcessRow extends RowDataPacket {
  MOIdMoto: number;
  MOBrand: string;
  MOModel: string;
  MOYear: string | number;
  MOColor: string;
  MOPlate: string | null;
  STIdState: number | null;
  STState: string | null;
  PRFirstDate: string | null;
}

export interface MotorcycleInvoiceProcessData {
  brand: string;
  model: string;
  year: string | number;
  color: string;
  plate: string | null;
  latestState: {
    id: number;
    name: string;
    registeredDate: string;
  } | null;
}
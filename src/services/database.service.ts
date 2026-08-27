import pool from "../config/database.js";
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

export async function addMotorcycle (
  CUIdCustomer: string,
  MOPlate: string,
    MOBrand: string,
    MOModel: string,
    MOYear: string,
    MOColor: string,
    MOCilindraje: string,
    MOVin: string,
    MOMiles: string,
    MOChassis: string,
    MOSerieInvoice: string,
    MONumberInvoice: string
): Promise<ResultSetHeader> {
  const query = `INSERT INTO MOTORCYCLES
      (
        CUIdCustomer,
        MOPlate,
        MOBrand,
        MOModel,
        MOYear,
        MOColor,
        MOCilindraje,
        MOVin,
        MOMiles,
        MOChassis,
        MOSerieInvoice,
        MONumberInvoice
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const [result] = await pool.execute<ResultSetHeader>(query, [
    CUIdCustomer,
    MOPlate,
    MOBrand,
    MOModel,
    MOYear,
    MOColor,
    MOCilindraje,
    MOVin,
    MOMiles,
    MOChassis,
    MOSerieInvoice,
    MONumberInvoice,
  ]);
  return result;
}
    
export async function getClientByNit(nit: string): Promise<any> {
  const query = `SELECT * FROM CUSTOMER WHERE CUNIT = ?`;
  const [rows] = await pool.execute(query, [nit]);
  return rows;
}

export async function addProcess(idMotorcycle: number, observations: string): Promise<ResultSetHeader> {
  const query = `INSERT INTO PROCESSING (MOIdMoto, STIdState, PRObservations, PRFirstDate, PRDateUpdate) VALUES (?, ?, ?, CURDATE(), CURDATE())`;
  const [result] = await pool.execute<ResultSetHeader>(query, [idMotorcycle, 1, observations]);
  return result;
}

export async function getUserByEmail(email: string): Promise<UserRow[]> {
  const query = `SELECT * FROM USERS WHERE USEmail = ?`;
  const [rows] = await pool.execute<UserRow[]>(query, [email]);
  return rows;
}

export async function getMotorcycleByPlate(plate: string): Promise<any> {
  const query = `SELECT * FROM MOTORCYCLES WHERE MOPlate = ?`;
  const [rows] = await pool.execute(query, [plate]);
  return rows;
}

export async function getMotorcycleByInvoice(
  serieInvoice: string,
  numberInvoice: string
): Promise<any> {
  const query = `SELECT * FROM MOTORCYCLES WHERE MOSerieInvoice = ? AND MONumberInvoice = ?`;
  const [rows] = await pool.execute(query, [serieInvoice, numberInvoice]);
  return rows;
}

export async function updateUltimateLoginDate(userId: number): Promise<void> {
  const query = `UPDATE USERS SET USFregister = NOW() WHERE USId = ?`;
  await pool.execute(query, [userId]);
}

export async function addUser(name: string, roleId: number, lastname: string, email: string, phone: string, password: string): Promise<ResultSetHeader> {
  const query = `INSERT INTO USERS (USName, ROIdRol, USLastName, USEmail, USPhone, USPassword) VALUES (?, ?, ?, ?, ?, ?)`;
  const [result] = await pool.execute<ResultSetHeader>(query, [name, roleId, lastname, email, phone, password]);
  return result;
}

import pool from "../config/database.js";
import type { ResultSetHeader } from "mysql2";

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

export async function getUserByUsername(username: string): Promise<any> {
  const query = `SELECT * FROM USER WHERE USUsername = ?`;
  const [rows] = await pool.execute(query, [username]);
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
  const query = `UPDATE USER SET USFregister = NOW() WHERE USIdUser = ?`;
  await pool.execute(query, [userId]);
}

export async function addUser(name: string, rol: string, lastname: string, email: string, phone: string, password: string): Promise<ResultSetHeader> {
  const query = `INSERT INTO USER (USName, USRol, USLastname, USEmail, USPhone, USPassword) VALUES (?, ?, ?, ?, ?, ?)`;
  const [result] = await pool.execute<ResultSetHeader>(query, [name, rol, lastname, email, phone, password]);
  return result;
}
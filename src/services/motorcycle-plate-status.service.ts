export function withoutRegisteredPlateSql(column = "MOPlate"): string {
  if (!/^[A-Z][A-Z0-9_.]*$/i.test(column)) throw new TypeError("Invalid SQL column reference");
  return `(${column} IS NULL OR TRIM(${column}) = '')`;
}

export const WITHOUT_REGISTERED_PLATE_SQL = withoutRegisteredPlateSql();

export function normalizePlateForStorage(plate: string | null): string | null {
  if (plate === null) return null;
  const normalized = plate.trim();
  return normalized.length > 0 ? normalized : null;
}

export function hasRegisteredPlate(plate: string | null): boolean {
  return plate !== null && plate.trim().length > 0;
}

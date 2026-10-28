import crypto from "node:crypto";
import type { ResultSetHeader } from "mysql2";
import pool from "../config/database.js";
import type {
  AccentPreference, BackgroundPreference, EmailCountRow, MediaKind, ModulePreference,
  PreferenceWriteInput, SettingsRepository, ThemePreference, UserMediaRow,
  UserPasswordRow, UserPreferenceRow, UserProfileRow,
} from "../interfaces/settings.interface.js";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

interface ModuleDefinition {
  id: string; label: string; path: string; roleIds: readonly number[] | null; configurable: boolean;
}

const moduleCatalog: readonly ModuleDefinition[] = [
  { id: "home", label: "Inicio", path: "/", roleIds: null, configurable: false },
  { id: "plates", label: "Proceso de placas", path: "/Plates", roleIds: [1], configurable: true },
  { id: "customers", label: "Clientes", path: "/Customers", roleIds: [1], configurable: true },
  { id: "motorcycles", label: "Registro de motos", path: "/Motorcycle", roleIds: [1], configurable: true },
  { id: "maintenance", label: "Mantenimiento", path: "/Maintenance", roleIds: [1], configurable: true },
  { id: "reminders", label: "Recordatorios", path: "/Reminders", roleIds: [1], configurable: true },
  { id: "profile", label: "Perfil", path: "/Profile", roleIds: null, configurable: true },
  { id: "settings", label: "Configuración", path: "/Settings", roleIds: null, configurable: false },
];

const themes = new Set<ThemePreference>(["light", "dark", "system"]);
const accents = new Set<AccentPreference>(["red", "blue", "purple", "green", "yellow", "orange", "sky", "pink"]);
const backgrounds = new Set<BackgroundPreference>(["motorcycle", "gray", "white", "custom"]);

export class SettingsValidationError extends Error {}
export class SettingsConflictError extends Error {}
export class SettingsNotFoundError extends Error {}
export class SettingsAuthenticationError extends Error {}

function assertAllowedFields(input: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedFields = new Set(allowed);
  const unknown = Object.keys(input).filter((field) => !allowedFields.has(field));
  if (unknown.length > 0) throw new SettingsValidationError(`Unknown fields: ${unknown.join(", ")}`);
}

function availableModules(roleId: number | null): ModuleDefinition[] {
  return moduleCatalog.filter((module) => module.roleIds === null || (roleId !== null && module.roleIds.includes(roleId)));
}

function defaultModules(roleId: number | null): ModulePreference[] {
  return availableModules(roleId).map((module) => ({ id: module.id, visible: true }));
}

function parseStoredModules(value: UserPreferenceRow["UPModules"]): ModulePreference[] | null {
  try {
    const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return null;
    const modules = parsed.filter((item): item is ModulePreference => (
      typeof item === "object" && item !== null
      && typeof (item as Record<string, unknown>).id === "string"
      && typeof (item as Record<string, unknown>).visible === "boolean"
    ));
    return modules.length === parsed.length ? modules : null;
  } catch { return null; }
}

function normalizeModules(input: unknown, roleId: number | null, fallback: ModulePreference[]): ModulePreference[] {
  if (input === undefined) return fallback;
  if (!Array.isArray(input)) throw new SettingsValidationError("modules must be an array");
  const allowed = availableModules(roleId);
  const allowedIds = new Set(allowed.map((module) => module.id));
  const seen = new Set<string>();
  const normalized: ModulePreference[] = [];

  for (const item of input) {
    if (typeof item !== "object" || item === null) throw new SettingsValidationError("Invalid module configuration");
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !allowedIds.has(record.id) || seen.has(record.id)) {
      throw new SettingsValidationError("Invalid or duplicated module id");
    }
    if (typeof record.visible !== "boolean") throw new SettingsValidationError("Module visibility must be boolean");
    seen.add(record.id);
    const definition = allowed.find((module) => module.id === record.id)!;
    normalized.push({ id: record.id, visible: definition.configurable ? record.visible : true });
  }
  for (const module of allowed) {
    if (!seen.has(module.id)) normalized.push({ id: module.id, visible: module.configurable ? false : true });
  }
  return normalized;
}

function normalizeStoredModules(value: UserPreferenceRow["UPModules"], roleId: number | null): ModulePreference[] {
  const defaults = defaultModules(roleId);
  const parsed = parseStoredModules(value);
  if (!parsed) return defaults;
  try { return normalizeModules(parsed, roleId, defaults); }
  catch { return defaults; }
}

function ensureHomePage(homePage: unknown, modules: ModulePreference[], fallback = "home"): string {
  if (homePage === undefined) {
    const current = modules.find((module) => module.id === fallback);
    return current?.visible ? fallback : "home";
  }
  if (typeof homePage !== "string") throw new SettingsValidationError("homePage must be a string");
  return modules.find((module) => module.id === homePage)?.visible ? homePage : "home";
}

function booleanValue(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new SettingsValidationError(`${field} must be boolean`);
  return value;
}

function enumValue<T extends string>(value: unknown, fallback: T, allowed: Set<T>, field: string): T {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.has(value as T)) throw new SettingsValidationError(`Invalid ${field}`);
  return value as T;
}

export function getDefaultPreferences(roleId: number | null): PreferenceWriteInput {
  return {
    theme: "light", accentColor: "red", background: "motorcycle",
    modules: defaultModules(roleId), homePage: "home", compactMenu: false,
    showChatbot: true, notificationsEnabled: true,
  };
}

function mapPreferences(row: UserPreferenceRow | null, roleId: number | null): PreferenceWriteInput {
  const defaults = getDefaultPreferences(roleId);
  if (!row) return defaults;
  const modules = normalizeStoredModules(row.UPModules, roleId);
  return {
    theme: themes.has(row.UPTheme) ? row.UPTheme : defaults.theme,
    accentColor: accents.has(row.UPAccentColor) ? row.UPAccentColor : defaults.accentColor,
    background: backgrounds.has(row.UPBackground) ? row.UPBackground : defaults.background,
    modules,
    homePage: ensureHomePage(row.UPHomePage, modules),
    compactMenu: Boolean(row.UPCompactMenu),
    showChatbot: Boolean(row.UPShowChatbot),
    notificationsEnabled: Boolean(row.UPNotificationsEnabled),
  };
}

export function mergePreferences(current: PreferenceWriteInput, patch: Record<string, unknown>, roleId: number | null): PreferenceWriteInput {
  assertAllowedFields(patch, ["theme", "accentColor", "background", "modules", "homePage", "compactMenu", "showChatbot", "notificationsEnabled"]);
  const modules = normalizeModules(patch.modules, roleId, current.modules);
  return {
    theme: enumValue(patch.theme, current.theme, themes, "theme"),
    accentColor: enumValue(patch.accentColor, current.accentColor, accents, "accentColor"),
    background: enumValue(patch.background, current.background, backgrounds, "background"),
    modules,
    homePage: ensureHomePage(patch.homePage, modules, current.homePage),
    compactMenu: booleanValue(patch.compactMenu, current.compactMenu, "compactMenu"),
    showChatbot: booleanValue(patch.showChatbot, current.showChatbot, "showChatbot"),
    notificationsEnabled: booleanValue(patch.notificationsEnabled, current.notificationsEnabled, "notificationsEnabled"),
  };
}

export function detectImageMime(content: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const pngEnd = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  if (
    content.length >= 45
    && content.subarray(0, 8).equals(pngSignature)
    && content.subarray(12, 16).toString("ascii") === "IHDR"
    && content.readUInt32BE(16) > 0
    && content.readUInt32BE(20) > 0
    && content.subarray(-12).equals(pngEnd)
  ) return "image/png";

  if (
    content.length >= 4
    && content[0] === 0xff && content[1] === 0xd8
    && content[content.length - 2] === 0xff && content[content.length - 1] === 0xd9
  ) return "image/jpeg";

  if (
    content.length >= 20
    && content.subarray(0, 4).toString("ascii") === "RIFF"
    && content.readUInt32LE(4) + 8 === content.length
    && content.subarray(8, 12).toString("ascii") === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(content.subarray(12, 16).toString("ascii"))
  ) {
    let offset = 12;
    let validChunks = true;
    while (offset < content.length) {
      if (offset + 8 > content.length) { validChunks = false; break; }
      const chunkLength = content.readUInt32LE(offset + 4);
      offset += 8 + chunkLength + (chunkLength % 2);
      if (offset > content.length) { validChunks = false; break; }
    }
    if (validChunks && offset === content.length) return "image/webp";
  }
  return null;
}

const databaseRepository: SettingsRepository = {
  async getProfile(userId) {
    const [rows] = await pool.execute<UserProfileRow[]>(`
      SELECT U.USId, U.USName, U.USLastName, U.USEmail, U.USPhone, U.ROIdRol, R.ROName
      FROM USERS U LEFT JOIN ROL R ON R.ROIdRol = U.ROIdRol WHERE U.USId = ? LIMIT 1
    `, [userId]);
    return rows[0] ?? null;
  },
  async isEmailUsedByAnotherUser(userId, email) {
    const [rows] = await pool.execute<EmailCountRow[]>("SELECT COUNT(*) total FROM USERS WHERE LOWER(USEmail) = LOWER(?) AND USId <> ?", [email, userId]);
    return Number(rows[0]?.total ?? 0) > 0;
  },
  async updateProfile(userId, name, email) { await pool.execute("UPDATE USERS SET USName = ?, USEmail = ? WHERE USId = ?", [name, email, userId]); },
  async getPasswordHash(userId) {
    const [rows] = await pool.execute<UserPasswordRow[]>("SELECT USPassword FROM USERS WHERE USId = ? LIMIT 1", [userId]);
    return rows[0]?.USPassword ?? null;
  },
  async updatePasswordHash(userId, passwordHash) { await pool.execute("UPDATE USERS SET USPassword = ? WHERE USId = ?", [passwordHash, userId]); },
  async getPreferences(userId) {
    const [rows] = await pool.execute<UserPreferenceRow[]>("SELECT * FROM USER_PREFERENCES WHERE USId = ? LIMIT 1", [userId]);
    return rows[0] ?? null;
  },
  async savePreferences(userId, preferences) {
    await pool.execute(`
      INSERT INTO USER_PREFERENCES
        (USId, UPTheme, UPAccentColor, UPBackground, UPModules, UPHomePage, UPCompactMenu, UPShowChatbot, UPNotificationsEnabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE UPTheme = VALUES(UPTheme), UPAccentColor = VALUES(UPAccentColor),
        UPBackground = VALUES(UPBackground), UPModules = VALUES(UPModules), UPHomePage = VALUES(UPHomePage),
        UPCompactMenu = VALUES(UPCompactMenu), UPShowChatbot = VALUES(UPShowChatbot),
        UPNotificationsEnabled = VALUES(UPNotificationsEnabled)
    `, [userId, preferences.theme, preferences.accentColor, preferences.background, JSON.stringify(preferences.modules), preferences.homePage, preferences.compactMenu, preferences.showChatbot, preferences.notificationsEnabled]);
  },
  async resetPreferences(userId) { await pool.execute("DELETE FROM USER_PREFERENCES WHERE USId = ?", [userId]); },
  async getMedia(userId, kind) {
    const [rows] = await pool.execute<UserMediaRow[]>("SELECT UMMimeType, UMContent, UMSize, UMUpdatedAt FROM USER_MEDIA WHERE USId = ? AND UMKind = ? LIMIT 1", [userId, kind]);
    return rows[0] ?? null;
  },
  async saveMedia(userId, kind, mediaKey, mimeType, content) {
    const [result] = await pool.execute<ResultSetHeader>(`
      INSERT INTO USER_MEDIA (UMId, USId, UMKind, UMMimeType, UMContent, UMSize) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE UMId = VALUES(UMId), UMMimeType = VALUES(UMMimeType),
        UMContent = VALUES(UMContent), UMSize = VALUES(UMSize)
    `, [mediaKey, userId, kind, mimeType, content, content.length]);
    return result;
  },
  async deleteMedia(userId, kind) {
    const [result] = await pool.execute<ResultSetHeader>("DELETE FROM USER_MEDIA WHERE USId = ? AND UMKind = ?", [userId, kind]);
    return result.affectedRows > 0;
  },
};

export function createSettingsService(repository: SettingsRepository = databaseRepository) {
  async function profile(userId: number) {
    const record = await repository.getProfile(userId);
    if (!record) throw new SettingsNotFoundError("User not found");
    return {
      id: record.USId, name: record.USName, lastName: record.USLastName, email: record.USEmail,
      phone: record.USPhone, role: record.ROIdRol === null ? null : { id: record.ROIdRol, name: record.ROName },
      avatarUrl: await repository.getMedia(userId, "AVATAR") ? "/api/settings/avatar" : null,
    };
  }

  async function updateProfile(userId: number, input: Record<string, unknown>) {
    assertAllowedFields(input, ["name", "email"]);
    const current = await repository.getProfile(userId);
    if (!current) throw new SettingsNotFoundError("User not found");
    const name = input.name === undefined ? current.USName : typeof input.name === "string" ? input.name.trim() : "";
    const email = input.email === undefined ? current.USEmail : typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!name || name.length > 100) throw new SettingsValidationError("Name is required and must not exceed 100 characters");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150) throw new SettingsValidationError("Invalid email");
    if (await repository.isEmailUsedByAnotherUser(userId, email)) throw new SettingsConflictError("Email already in use");
    await repository.updateProfile(userId, name, email);
    return profile(userId);
  }

  async function changePassword(userId: number, input: Record<string, unknown>) {
    assertAllowedFields(input, ["currentPassword", "newPassword"]);
    const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";
    const newPassword = typeof input.newPassword === "string" ? input.newPassword : "";
    if (!currentPassword || !newPassword) throw new SettingsValidationError("Current and new passwords are required");
    if (newPassword.length < 8 || newPassword.length > 128) throw new SettingsValidationError("New password must contain between 8 and 128 characters");
    const storedHash = await repository.getPasswordHash(userId);
    if (!storedHash) throw new SettingsNotFoundError("User not found");
    const currentHash = crypto.createHash("sha256").update(currentPassword).digest("hex");
    const storedBuffer = Buffer.from(storedHash, "utf8");
    const inputBuffer = Buffer.from(currentHash, "utf8");
    if (storedBuffer.length !== inputBuffer.length || !crypto.timingSafeEqual(storedBuffer, inputBuffer)) throw new SettingsAuthenticationError("Current password is incorrect");
    await repository.updatePasswordHash(userId, crypto.createHash("sha256").update(newPassword).digest("hex"));
  }

  async function preferences(userId: number, roleId: number | null) {
    const value = mapPreferences(await repository.getPreferences(userId), roleId);
    return {
      ...value,
      customBackgroundUrl: await repository.getMedia(userId, "BACKGROUND") ? "/api/settings/background-image" : null,
      capabilities: { personalNotificationsImplemented: false, maintenanceClientEmailsAffected: false },
    };
  }

  async function updatePreferences(userId: number, roleId: number | null, patch: Record<string, unknown>) {
    const updated = mergePreferences(mapPreferences(await repository.getPreferences(userId), roleId), patch, roleId);
    if (updated.background === "custom" && !await repository.getMedia(userId, "BACKGROUND")) throw new SettingsValidationError("Upload a custom background before selecting it");
    await repository.savePreferences(userId, updated);
    return preferences(userId, roleId);
  }

  async function resetPreferences(userId: number, roleId: number | null) {
    await repository.resetPreferences(userId);
    return preferences(userId, roleId);
  }

  async function personalNotificationsPreference(userId: number): Promise<boolean> {
    const stored = await repository.getPreferences(userId);
    return stored ? Boolean(stored.UPNotificationsEnabled) : true;
  }

  async function saveMedia(userId: number, kind: MediaKind, content: Buffer) {
    if (content.length === 0 || content.length > MAX_IMAGE_BYTES) throw new SettingsValidationError("Image must not exceed 2 MB");
    const mimeType = detectImageMime(content);
    if (!mimeType) throw new SettingsValidationError("Only PNG, JPEG and WebP images are allowed");
    await repository.saveMedia(userId, kind, crypto.randomUUID(), mimeType, content);
    return { url: kind === "AVATAR" ? "/api/settings/avatar" : "/api/settings/background-image", mimeType, size: content.length };
  }

  return {
    profile, updateProfile, changePassword, preferences, updatePreferences, resetPreferences,
    personalNotificationsPreference,
    moduleCatalog: (roleId: number | null) => availableModules(roleId).map(({ roleIds: _roleIds, ...module }) => module),
    saveMedia,
    getMedia: (userId: number, kind: MediaKind) => repository.getMedia(userId, kind),
    deleteMedia: (userId: number, kind: MediaKind) => repository.deleteMedia(userId, kind),
  };
}

export const settingsService = createSettingsService();

import type { ResultSetHeader, RowDataPacket } from "mysql2";

export type ThemePreference = "light" | "dark" | "system";
export type AccentPreference = "red" | "blue" | "purple" | "green" | "yellow" | "orange" | "sky" | "pink";
export type BackgroundPreference = "motorcycle" | "gray" | "white" | "custom";
export type MediaKind = "AVATAR" | "BACKGROUND";

export interface ModulePreference { id: string; visible: boolean; }

export interface UserProfileRow extends RowDataPacket {
  USId: number; USName: string; USLastName: string; USEmail: string;
  USPhone: string | null; ROIdRol: number | null; ROName: string | null;
}
export interface UserPasswordRow extends RowDataPacket { USPassword: string; }
export interface EmailCountRow extends RowDataPacket { total: number; }
export interface UserPreferenceRow extends RowDataPacket {
  UPTheme: ThemePreference; UPAccentColor: AccentPreference; UPBackground: BackgroundPreference;
  UPModules: string | ModulePreference[]; UPHomePage: string;
  UPCompactMenu: number | boolean; UPShowChatbot: number | boolean; UPNotificationsEnabled: number | boolean;
}
export interface UserMediaRow extends RowDataPacket {
  UMMimeType: string; UMContent: Buffer; UMSize: number; UMUpdatedAt: Date;
}
export interface PreferenceWriteInput {
  theme: ThemePreference; accentColor: AccentPreference; background: BackgroundPreference;
  modules: ModulePreference[]; homePage: string; compactMenu: boolean;
  showChatbot: boolean; notificationsEnabled: boolean;
}
export interface SettingsRepository {
  getProfile(userId: number): Promise<UserProfileRow | null>;
  isEmailUsedByAnotherUser(userId: number, email: string): Promise<boolean>;
  updateProfile(userId: number, name: string, email: string): Promise<void>;
  getPasswordHash(userId: number): Promise<string | null>;
  updatePasswordHash(userId: number, passwordHash: string): Promise<void>;
  getPreferences(userId: number): Promise<UserPreferenceRow | null>;
  savePreferences(userId: number, preferences: PreferenceWriteInput): Promise<void>;
  resetPreferences(userId: number): Promise<void>;
  getMedia(userId: number, kind: MediaKind): Promise<UserMediaRow | null>;
  saveMedia(userId: number, kind: MediaKind, mediaKey: string, mimeType: string, content: Buffer): Promise<ResultSetHeader | void>;
  deleteMedia(userId: number, kind: MediaKind): Promise<boolean>;
}

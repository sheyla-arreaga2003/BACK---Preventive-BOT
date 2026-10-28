import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import type { SettingsRepository, UserPreferenceRow, UserProfileRow } from "../src/interfaces/settings.interface.js";
import {
  SettingsAuthenticationError, SettingsConflictError, SettingsValidationError, createSettingsService,
  detectImageMime, getDefaultPreferences, mergePreferences,
} from "../src/services/settings.service.js";

function repository(overrides: Partial<SettingsRepository> = {}): SettingsRepository {
  const profile = {
    USId: 7, USName: "Shey", USLastName: "Arreaga", USEmail: "shey@example.com",
    USPhone: null, ROIdRol: 1, ROName: "Administrador",
  } as UserProfileRow;
  return {
    async getProfile(userId) { return userId === 7 ? profile : null; },
    async isEmailUsedByAnotherUser() { return false; },
    async updateProfile() {},
    async getPasswordHash() { return crypto.createHash("sha256").update("actual-segura").digest("hex"); },
    async updatePasswordHash() {},
    async getPreferences() { return null; },
    async savePreferences() {},
    async resetPreferences() {},
    async getMedia() { return null; },
    async saveMedia() {},
    async deleteMedia() { return false; },
    ...overrides,
  };
}

test("returns complete defaults when the user has no stored preferences", async () => {
  const service = createSettingsService(repository());
  const result = await service.preferences(7, 1);
  assert.equal(result.theme, "light");
  assert.equal(result.accentColor, "red");
  assert.equal(result.background, "motorcycle");
  assert.equal(result.homePage, "home");
  assert.equal(result.compactMenu, false);
  assert.equal(result.showChatbot, true);
  assert.ok(result.modules.every((module) => module.visible));
  assert.equal(result.capabilities.personalNotificationsImplemented, false);
});

test("partial updates preserve omitted fields and force Home and Settings to remain visible", () => {
  const current = getDefaultPreferences(1);
  const updated = mergePreferences(current, {
    theme: "dark",
    modules: current.modules.map((module) => ({ ...module, visible: !["home", "settings"].includes(module.id) })),
  }, 1);
  assert.equal(updated.theme, "dark");
  assert.equal(updated.accentColor, "red");
  assert.equal(updated.modules.find((module) => module.id === "home")?.visible, true);
  assert.equal(updated.modules.find((module) => module.id === "settings")?.visible, true);
});

test("accepts every supported accent color and rejects unknown values", () => {
  const current = getDefaultPreferences(1);
  const accents = ["red", "blue", "purple", "green", "yellow", "orange", "sky", "pink"] as const;

  for (const accentColor of accents) {
    assert.equal(mergePreferences(current, { accentColor }, 1).accentColor, accentColor);
  }

  assert.throws(() => mergePreferences(current, { accentColor: "teal" }, 1), SettingsValidationError);
});

test("a hidden or inaccessible start page falls back to home", () => {
  const current = getDefaultPreferences(1);
  const modules = current.modules.map((module) => ({ ...module, visible: module.id !== "maintenance" }));
  assert.equal(mergePreferences(current, { modules, homePage: "maintenance" }, 1).homePage, "home");
  assert.throws(() => mergePreferences(current, { modules: [{ id: "unknown", visible: true }] }, 1), SettingsValidationError);
});

test("module catalog excludes administrator modules from an unrelated role", () => {
  const service = createSettingsService(repository());
  const ids = service.moduleCatalog(2).map((module) => module.id);
  assert.deepEqual(ids, ["home", "profile", "settings"]);
});

test("password change validates the current password and stores only a hash", async () => {
  let saved = "";
  const service = createSettingsService(repository({ async updatePasswordHash(_userId, hash) { saved = hash; } }));
  await service.changePassword(7, { currentPassword: "actual-segura", newPassword: "nueva-segura" });
  assert.equal(saved, crypto.createHash("sha256").update("nueva-segura").digest("hex"));
  await assert.rejects(
    service.changePassword(7, { currentPassword: "incorrecta", newPassword: "otra-segura" }),
    SettingsAuthenticationError,
  );
});

test("profile updates preserve omitted fields and reject a duplicated login email", async () => {
  let saved: { userId: number; name: string; email: string } | null = null;
  const service = createSettingsService(repository({
    async updateProfile(userId, name, email) { saved = { userId, name, email }; },
  }));
  await service.updateProfile(7, { name: "Sheyla" });
  assert.deepEqual(saved, { userId: 7, name: "Sheyla", email: "shey@example.com" });

  const duplicateService = createSettingsService(repository({ async isEmailUsedByAnotherUser() { return true; } }));
  await assert.rejects(duplicateService.updateProfile(7, { email: "other@example.com" }), SettingsConflictError);
});

test("reset removes only preferences and leaves avatar and background media untouched", async () => {
  let preferencesReset = 0;
  let mediaDeletes = 0;
  const service = createSettingsService(repository({
    async resetPreferences() { preferencesReset += 1; },
    async deleteMedia() { mediaDeletes += 1; return true; },
  }));
  const result = await service.resetPreferences(7, 1);
  assert.equal(preferencesReset, 1);
  assert.equal(mediaDeletes, 0);
  assert.equal(result.theme, "light");
});

test("settings operations use only the authenticated user id supplied by the route", async () => {
  const touched: number[] = [];
  const service = createSettingsService(repository({
    async getPreferences(userId) { touched.push(userId); return null; },
    async savePreferences(userId) { touched.push(userId); },
  }));
  await service.updatePreferences(7, 1, { theme: "system" });
  assert.deepEqual(touched, [7, 7, 7]);
});

test("stored preferences are parsed and invalid module data falls back safely", async () => {
  const stored = {
    UPTheme: "dark", UPAccentColor: "blue", UPBackground: "gray",
    UPModules: "not-json", UPHomePage: "maintenance", UPCompactMenu: 1,
    UPShowChatbot: 0, UPNotificationsEnabled: 1,
  } as UserPreferenceRow;
  const service = createSettingsService(repository({ async getPreferences() { return stored; } }));
  const result = await service.preferences(7, 1);
  assert.equal(result.theme, "dark");
  assert.equal(result.homePage, "maintenance");
  assert.ok(result.modules.every((module) => module.visible));
});

test("rejects fields that could attempt to modify roles or unsupported preferences", async () => {
  const service = createSettingsService(repository());
  await assert.rejects(service.updateProfile(7, { roleId: 2 }), SettingsValidationError);
  await assert.rejects(service.changePassword(7, { currentPassword: "actual-segura", newPassword: "nueva-segura", userId: 9 }), SettingsValidationError);
  await assert.rejects(service.updatePreferences(7, 1, { notificationSound: true }), SettingsValidationError);
});

test("future notification service can read the stored preference without affecting client reminders", async () => {
  const disabled = {
    UPTheme: "light", UPAccentColor: "red", UPBackground: "motorcycle",
    UPModules: [], UPHomePage: "home", UPCompactMenu: 0,
    UPShowChatbot: 1, UPNotificationsEnabled: 0,
  } as UserPreferenceRow;
  const service = createSettingsService(repository({ async getPreferences() { return disabled; } }));
  assert.equal(await service.personalNotificationsPreference(7), false);
  assert.equal(await createSettingsService(repository()).personalNotificationsPreference(7), true);
});

test("image validation checks file signatures instead of trusting the content type", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2Q==", "base64");
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0, "ascii");
  webp.writeUInt32LE(22, 4);
  webp.write("WEBPVP8X", 8, "ascii");
  webp.writeUInt32LE(10, 16);
  assert.equal(detectImageMime(png), "image/png");
  assert.equal(detectImageMime(jpeg), "image/jpeg");
  assert.equal(detectImageMime(webp), "image/webp");
  assert.equal(detectImageMime(png.subarray(0, 20)), null);
  assert.equal(detectImageMime(Buffer.from("not an image")), null);
});

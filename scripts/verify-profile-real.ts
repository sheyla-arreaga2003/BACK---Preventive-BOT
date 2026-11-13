import crypto from "node:crypto";
import fs from "node:fs/promises";
import "dotenv/config";
import jwt from "jsonwebtoken";
import mysql from "mysql2/promise";
import { createClient } from "redis";

const statePath = "/private/tmp/pb-profile-verification-state.json";
const baseUrl = process.env.PROFILE_TEST_BASE_URL ?? "http://127.0.0.1:3199";
const prefix = process.env.REDIS_KEY_PREFIX ?? "";

interface State {
  password: string;
  secondPassword: string;
  firstEmail: string;
  secondEmail: string;
  userIds: number[];
  customerIds: number[];
  motorcycleIds: number[];
  maintenanceIds: number[];
  appointmentIds: number[];
  processIds: number[];
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function request(path: string, options: RequestInit = {}, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) as Record<string, unknown> : null;
  assert(response.status === expected, `${options.method ?? "GET"} ${path}: expected ${expected}, got ${response.status}`);
  return { response, body };
}

function bearer(token: string, body?: unknown, userAgent?: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(userAgent ? { "User-Agent": userAgent } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

async function login(email: string, password: string, userAgent: string) {
  const result = await request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": userAgent },
    body: JSON.stringify({ email, password }),
  });
  const token = result.body?.token;
  const sessionid = result.body?.sessionid;
  assert(typeof token === "string" && typeof sessionid === "string", "Login did not return credentials");
  return { token, sessionid };
}

function connectionOptions() {
  return {
    host: requiredEnvironment("DB_HOST"),
    port: Number(process.env.DB_PORT),
    user: requiredEnvironment("DB_USER"),
    password: requiredEnvironment("DB_PASSWORD"),
    database: requiredEnvironment("DB_NAME"),
  };
}

async function clean(state: State): Promise<void> {
  const db = await mysql.createConnection(connectionOptions());
  await db.beginTransaction();
  try {
    for (const id of state.appointmentIds) {
      await db.execute("DELETE FROM MAINTENANCE_APPOINTMENT_SERVICE WHERE MAPIdAppointment = ?", [id]);
      await db.execute("DELETE FROM MAINTENANCE_APPOINTMENT WHERE MAPIdAppointment = ?", [id]);
    }
    for (const id of state.maintenanceIds) {
      await db.execute("DELETE FROM DETAIL_MAINTENANCE WHERE MAMaintenance = ?", [id]);
      await db.execute("DELETE FROM REMINDER WHERE MAMaintenance = ?", [id]);
      await db.execute("DELETE FROM MAINTENANCE WHERE MAMaintenance = ?", [id]);
    }
    for (const id of state.processIds) await db.execute("DELETE FROM PROCESSING WHERE PRIdProcess = ?", [id]);
    for (const id of state.motorcycleIds) await db.execute("DELETE FROM MOTORCYCLES WHERE MOIdMoto = ?", [id]);
    for (const id of state.customerIds) await db.execute("DELETE FROM CUSTOMER WHERE CUIdCustomer = ?", [id]);
    for (const id of state.userIds) {
      await db.execute("DELETE FROM USER_ACTIVITY WHERE USId = ?", [id]);
      await db.execute("DELETE FROM USER_MEDIA WHERE USId = ?", [id]);
      await db.execute("DELETE FROM USER_PREFERENCES WHERE USId = ?", [id]);
      await db.execute("DELETE FROM USERS WHERE USId = ?", [id]);
    }
    await db.commit();
  } catch (error) {
    await db.rollback();
    throw error;
  } finally {
    await db.end();
  }

  const redis = createClient({ url: requiredEnvironment("REDIS_URL") });
  await redis.connect();
  for await (const keys of redis.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
    if (keys.length > 0) await redis.del(keys);
  }
  await redis.quit();
}

async function firstPhase(): Promise<void> {
  assert(prefix.startsWith("preventive-bot:test:profile:"), "An exclusive Redis test prefix is required");
  const marker = crypto.randomBytes(5).toString("hex");
  const state: State = {
    password: crypto.randomBytes(24).toString("base64url"),
    secondPassword: crypto.randomBytes(24).toString("base64url"),
    firstEmail: `pb-profile-a-${marker}@example.invalid`,
    secondEmail: `pb-profile-b-${marker}@example.invalid`,
    userIds: [], customerIds: [], motorcycleIds: [], maintenanceIds: [], appointmentIds: [], processIds: [],
  };
  const db = await mysql.createConnection(connectionOptions());
  try {
    const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
    const [first] = await db.execute<mysql.ResultSetHeader>(
      "INSERT INTO USERS (USName, ROIdRol, USLastName, USEmail, USPhone, USPassword) VALUES (?, 1, ?, ?, ?, ?)",
      ["PB Perfil A", "Prueba", state.firstEmail, "+502 55550001", hash(state.password)],
    );
    const [second] = await db.execute<mysql.ResultSetHeader>(
      "INSERT INTO USERS (USName, ROIdRol, USLastName, USEmail, USPhone, USPassword) VALUES (?, 1, ?, ?, ?, ?)",
      ["PB Perfil B", "Prueba", state.secondEmail, "+502 55550002", hash(state.secondPassword)],
    );
    state.userIds.push(first.insertId, second.insertId);

    await request("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: state.firstEmail, password: "incorrecta" }),
    }, 401);
    const [[beforeLogin]] = await db.query<mysql.RowDataPacket[]>("SELECT USLastLoginAt FROM USERS WHERE USId = ?", [first.insertId]);
    assert(beforeLogin?.USLastLoginAt === null, "A failed login changed last access");

    const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
    const current = await login(state.firstEmail, state.password, safari);
    const other = await login(state.firstEmail, state.password, chrome);
    const secondSession = await login(state.secondEmail, state.secondPassword, chrome);
    const [[afterLogin]] = await db.query<mysql.RowDataPacket[]>("SELECT USLastLoginAt FROM USERS WHERE USId = ?", [first.insertId]);
    assert(afterLogin?.USLastLoginAt !== null, "Successful login did not set last access");

    const redis = createClient({ url: requiredEnvironment("REDIS_URL") });
    await redis.connect();
    const currentKey = `${prefix}session:${current.sessionid}`;
    const serialized = await redis.get(currentKey);
    assert(serialized, "Current session is missing in Redis");
    const session = JSON.parse(serialized) as Record<string, unknown>;
    session.lastActivityAt = new Date(Date.now() - 120_000).toISOString();
    await redis.set(currentKey, JSON.stringify(session), { KEEPTTL: true });
    const ttlBefore = await redis.ttl(currentKey);
    await request("/api/profile/overview", bearer(current.token));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const touchedOnce = JSON.parse((await redis.get(currentKey))!) as Record<string, unknown>;
    const ttlAfter = await redis.ttl(currentKey);
    assert(ttlAfter > 0 && ttlAfter <= ttlBefore, "Activity extended the session TTL");
    await request("/api/profile/overview", bearer(current.token));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const touchedTwice = JSON.parse((await redis.get(currentKey))!) as Record<string, unknown>;
    assert(touchedOnce.lastActivityAt === touchedTwice.lastActivityAt, "Activity throttle was not respected");

    const profile = await request("/api/settings/profile", bearer(current.token));
    assert(profile.body?.role && profile.body?.registeredAt, "Read-only profile data is missing");
    await request("/api/settings/profile", {
      ...bearer(current.token, {
        name: "PB Perfil A Editado", lastName: "Integración", phone: "+502 55551001",
        email: state.firstEmail,
      }), method: "PATCH",
    });
    await request("/api/settings/profile", {
      ...bearer(current.token, { roleId: 2 }), method: "PATCH",
    }, 400);
    await request("/api/settings/profile", {
      ...bearer(current.token, { email: state.secondEmail }), method: "PATCH",
    }, 409);

    const newPassword = crypto.randomBytes(24).toString("base64url");
    await request("/api/settings/password", {
      ...bearer(current.token, { currentPassword: state.password, newPassword }), method: "PUT",
    });
    state.password = newPassword;
    await request("/api/profile/overview", bearer(other.token));

    const clientA = {
      CUNIT: `PT${marker}`.slice(0, 13), CUName: "Cliente PB", CULastName: "Perfil A",
      CUDPI: `9${marker.padEnd(12, "0")}`.slice(0, 13), CUPhone: "55550001",
      CUMail: `pb-client-a-${marker}@example.invalid`, CUAddress: "Dirección ficticia", CUState: 1,
    };
    const createdA = await request("/api/clients", { ...bearer(current.token, clientA), method: "POST" }, 201);
    const customerA = Number(createdA.body?.CUIdCustomer);
    state.customerIds.push(customerA);
    await request(`/api/clients/${encodeURIComponent(clientA.CUNIT)}`, {
      ...bearer(current.token, { ...clientA, CUName: "Cliente PB Actualizado" }), method: "PATCH",
    });
    await request("/api/clients", { ...bearer(current.token, clientA), method: "POST" }, 400);

    const clientB = {
      CUNIT: `PS${marker}`.slice(0, 13), CUName: "Cliente PB", CULastName: "Perfil B",
      CUDPI: `8${marker.padEnd(12, "1")}`.slice(0, 13), CUPhone: "55550002",
      CUMail: `pb-client-b-${marker}@example.invalid`, CUAddress: "Dirección ficticia", CUState: 1,
    };
    const createdB = await request("/api/clients", { ...bearer(secondSession.token, clientB), method: "POST" }, 201);
    state.customerIds.push(Number(createdB.body?.CUIdCustomer));

    const [motorcycle] = await db.execute<mysql.ResultSetHeader>(`
      INSERT INTO MOTORCYCLES
        (CUIdCustomer, MOPlate, MOBrand, MOModel, MOYear, MOColor, MOCilindraje,
         MOVin, MOMiles, MOChassis, MOSerieInvoice, MONumberInvoice)
      VALUES (?, ?, 'PBTEST', 'Perfil', '2026', 'Rojo', '125', ?, '100', ?, ?, ?)
    `, [customerA, `PBT${marker}`.slice(0, 20), `VINPB${marker}`, `CHPB${marker}`, `PF${marker}`.slice(0, 10), "00000001"]);
    state.motorcycleIds.push(motorcycle.insertId);

    const maintained = await request("/api/maintenance", {
      ...bearer(current.token, {
        motorcycleId: motorcycle.insertId, agencyId: 1, scheduleId: 1,
        date: "2099-12-30", mileage: "100", observations: "PB PROFILE TEST",
        nextMileage: "500", nextDate: "2099-12-31", serviceIds: [1],
      }), method: "POST",
    }, 201);
    state.maintenanceIds.push(Number(maintained.body?.id));
    await request("/api/maintenance", {
      ...bearer(current.token, {
        motorcycleId: 999999999, agencyId: 1, scheduleId: 1,
        date: "2099-12-29", mileage: "100", serviceIds: [1],
      }), method: "POST",
    }, 400);

    const processed = await request(`/api/motorcycles/${motorcycle.insertId}/process`, {
      ...bearer(current.token, { stateId: 1, observations: "PB PROFILE TEST" }), method: "POST",
    }, 201);
    state.processIds.push(Number(processed.body?.id));
    await request(`/api/motorcycles/${motorcycle.insertId}/process`, {
      ...bearer(current.token, { stateId: 999999, observations: "PB PROFILE TEST FAILURE" }), method: "POST",
    }, 404);

    const clientSession = await request("/api/chatbot/client/session", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serieInvoice: `PF${marker}`.slice(0, 10), numberInvoice: "00000001" }),
    }, 201);
    const clientToken = clientSession.body?.accessToken;
    assert(typeof clientToken === "string", "Client session was not created");
    const [beforeAppointment] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) total FROM USER_ACTIVITY WHERE USId = ? AND UAEventType = 'MAINTENANCE_CREATED'", [first.insertId]);
    const appointment = await request("/api/chatbot/client/maintenance/appointments", {
      method: "POST",
      headers: { Authorization: `Client ${clientToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ agencyId: 1, scheduleId: 2, date: "2099-12-31", mileage: "100", observations: "PB PROFILE TEST", serviceIds: [1] }),
    }, 201);
    state.appointmentIds.push(Number(appointment.body?.id));
    const [afterAppointment] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) total FROM USER_ACTIVITY WHERE USId = ? AND UAEventType = 'MAINTENANCE_CREATED'", [first.insertId]);
    assert(beforeAppointment[0]?.total === afterAppointment[0]?.total, "Appointment was counted as completed maintenance");

    const overviewA = await request("/api/profile/overview?from=2026-10-01&to=2026-10-31", bearer(current.token));
    const overviewB = await request("/api/profile/overview?from=2026-10-01&to=2026-10-31", bearer(secondSession.token));
    const statsA = overviewA.body?.stats as Record<string, number>;
    const statsB = overviewB.body?.stats as Record<string, number>;
    assert(statsA.clientsRegistered === 1 && statsA.maintenancesRegistered === 1 && statsA.plateProcessesUpdated === 1, "Admin A stats are incorrect");
    assert(statsB.clientsRegistered === 1 && statsB.maintenancesRegistered === 0 && statsB.plateProcessesUpdated === 0, "Admin B stats are not isolated");
    const activity = await request("/api/profile/activity?page=1&pageSize=2&from=2026-10-01&to=2026-10-31", bearer(current.token));
    const pagination = activity.body?.pagination as Record<string, number>;
    assert(pagination.total === 4 && pagination.totalPages === 2, "Activity pagination is incorrect");
    await request("/api/profile/activity?from=2025-01-01&to=2026-10-31", bearer(current.token), 400);

    const sessionsA = await request("/api/profile/sessions", bearer(current.token));
    const listA = sessionsA.body?.sessions as Array<Record<string, unknown>>;
    assert(listA.length === 2 && listA.some((item) => item.current === true), "Own sessions were not listed correctly");
    assert(!JSON.stringify(listA).includes(current.sessionid) && !JSON.stringify(listA).includes(current.token), "Sensitive session data was exposed");
    assert(listA.some((item) => item.browser === "Safari" && item.operatingSystem === "macOS"), "User-Agent approximation is missing");

    const sessionsB = await request("/api/profile/sessions", bearer(secondSession.token));
    const refB = (sessionsB.body?.sessions as Array<Record<string, unknown>>)[0]?.reference;
    assert(typeof refB === "string", "Second user's public session reference is missing");
    await request(`/api/profile/sessions/${refB}`, { ...bearer(current.token), method: "DELETE" }, 404);
    await request("/api/profile/overview", bearer(secondSession.token));

    const otherReference = listA.find((item) => item.current === false)?.reference;
    assert(typeof otherReference === "string", "Other session reference is missing");
    await request(`/api/profile/sessions/${otherReference}`, { ...bearer(current.token), method: "DELETE" });
    await request("/api/profile/overview", bearer(other.token), 401);

    const third = await login(state.firstEmail, state.password, chrome);
    await request("/api/profile/sessions/others", { ...bearer(current.token), method: "DELETE" });
    await request("/api/profile/overview", bearer(current.token));
    await request("/api/profile/overview", bearer(third.token), 401);

    const legacySid = crypto.randomUUID();
    await redis.set(`${prefix}session:${legacySid}`, JSON.stringify({ userId: first.insertId, email: state.firstEmail }), { EX: 3600 });
    await redis.sAdd(`${prefix}user-sessions:${first.insertId}`, legacySid);
    const legacyToken = jwt.sign({ sub: first.insertId, sid: legacySid }, process.env.JWT_SECRET!, { expiresIn: 3600 });
    const legacySessions = await request("/api/profile/sessions", bearer(legacyToken));
    const legacyCurrent = (legacySessions.body?.sessions as Array<Record<string, unknown>>).find((item) => item.current === true);
    assert(legacyCurrent?.createdAt === null, "Legacy session metadata should be unknown");
    await redis.quit();

    const [events] = await db.query<mysql.RowDataPacket[]>(`
      SELECT USId, UAEventType, COUNT(*) total FROM USER_ACTIVITY
      WHERE USId IN (?, ?) GROUP BY USId, UAEventType ORDER BY USId, UAEventType
    `, state.userIds);
    assert(events.reduce((sum, row) => sum + Number(row.total), 0) === 5, "Unexpected audit event count");

    await fs.writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
    console.log(JSON.stringify({
      phase: "before-restart",
      ids: state,
      checks: {
        httpProfile: true, audit: true, statsIsolation: true, pagination: true,
        appointmentSeparation: true, sessions: true, ttlNotExtended: true,
        activityThrottled: true, mysqlPersistencePrepared: true,
      },
    }, (key, value) => key.toLowerCase().includes("password") ? "[redacted]" : value, 2));
  } catch (error) {
    await clean(state);
    throw error;
  } finally {
    await db.end();
  }
}

async function secondPhase(): Promise<void> {
  const state = JSON.parse(await fs.readFile(statePath, "utf8")) as State;
  const db = await mysql.createConnection(connectionOptions());
  try {
    const session = await login(state.firstEmail, state.password, "Mozilla/5.0 (Macintosh) Safari/605.1.15");
    const overview = await request("/api/profile/overview?from=2026-10-01&to=2026-10-31", bearer(session.token));
    const [events] = await db.query<mysql.RowDataPacket[]>("SELECT UAId,UAEventType,UAEntityType,UAEntityId FROM USER_ACTIVITY WHERE USId = ? ORDER BY UAId", [state.userIds[0]]);
    const [[access]] = await db.query<mysql.RowDataPacket[]>("SELECT USLastLoginAt FROM USERS WHERE USId = ?", [state.userIds[0]]);
    assert(events.length === 4, "Activity did not persist after restart");
    assert(access?.USLastLoginAt !== null, "Last access did not persist after restart");
    assert((overview.body?.recentActivity as unknown[]).length === 4, "HTTP activity did not persist after restart");
    console.log(JSON.stringify({
      phase: "after-restart",
      persistedActivityRows: events.length,
      lastLoginPersisted: true,
      cleanupIds: {
        users: state.userIds, customers: state.customerIds, motorcycles: state.motorcycleIds,
        maintenances: state.maintenanceIds, appointments: state.appointmentIds, processes: state.processIds,
      },
    }, null, 2));
  } finally {
    await db.end();
  }
  await clean(state);
  await fs.rm(statePath, { force: true });

  const verify = await mysql.createConnection(connectionOptions());
  const [[remaining]] = await verify.query<mysql.RowDataPacket[]>(`
    SELECT
      (SELECT COUNT(*) FROM USERS WHERE USId IN (?, ?)) AS usersRemaining,
      (SELECT COUNT(*) FROM USER_ACTIVITY WHERE USId IN (?, ?)) AS activityRemaining
  `, [...state.userIds, ...state.userIds]);
  await verify.end();
  assert(Number(remaining?.usersRemaining) === 0 && Number(remaining?.activityRemaining) === 0, "Fixture cleanup was incomplete");
  console.log(JSON.stringify({ phase: "cleanup", mysqlFixtureRowsRemaining: 0, redisTestPrefixCleared: true }, null, 2));
}

const phase = process.argv[2];
if (phase === "before-restart") await firstPhase();
else if (phase === "after-restart") await secondPhase();
else throw new Error("Use before-restart or after-restart");


export interface AuthFailure {
  success: false;
  reason: "invalid_credentials" | "database_unavailable" | "session_store_unavailable";
}

export interface LoginSuccess {
  success: true;
  sessionid: string;
  token: string;
  USName: string;
}

export interface SessionData {
  userId: number;
  email: string;
}

export interface TokenSuccess {
  success: true;
  userId: number;
  sessionid: string;
  session: SessionData;
}

export interface TokenFailure {
  success: false;
  reason: "invalid_token" | "invalid_session" | "session_store_unavailable";
}
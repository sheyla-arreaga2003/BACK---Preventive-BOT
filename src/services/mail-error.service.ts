export type MailErrorCategory =
  | "AUTHENTICATION"
  | "ACCOUNT_AUTHORIZATION"
  | "CONNECTION"
  | "RECIPIENT_REJECTED"
  | "PROVIDER_TEMPORARY"
  | "SEND_LIMIT"
  | "UNKNOWN";

export interface PublicMailError {
  category: MailErrorCategory;
  title: string;
  message: string;
  recommendation: string;
  attemptStatus: string;
  retryable: boolean;
}

interface MailErrorLike {
  code?: unknown;
  responseCode?: unknown;
  response?: unknown;
  message?: unknown;
  rejected?: unknown;
}

const DEFINITIONS: Record<MailErrorCategory, Omit<PublicMailError, "category">> = {
  AUTHENTICATION: {
    title: "No se pudo enviar el correo",
    message: "Gmail rechazó el acceso de la cuenta que Preventive Bot utiliza para enviar mensajes.",
    recommendation: "Comunícate con el encargado técnico para que revise la configuración y autorización de la cuenta de correo de Mototec.",
    attemptStatus: "El servidor rechazó este intento de envío.",
    retryable: false,
  },
  ACCOUNT_AUTHORIZATION: {
    title: "No se pudo enviar el correo",
    message: "La cuenta de correo del sistema no tiene la autorización necesaria para enviar mensajes.",
    recommendation: "Comunícate con el encargado técnico para que revise la autorización de la cuenta de correo de Mototec.",
    attemptStatus: "El servidor rechazó este intento de envío.",
    retryable: false,
  },
  CONNECTION: {
    title: "No se pudo enviar el correo",
    message: "No fue posible establecer comunicación con el servicio de correo.",
    recommendation: "Intenta nuevamente más tarde. Si el problema continúa, informa al encargado técnico.",
    attemptStatus: "El mensaje no se envió porque no fue posible contactar al servicio de correo.",
    retryable: true,
  },
  RECIPIENT_REJECTED: {
    title: "No se pudo enviar el correo",
    message: "El servicio de correo rechazó la dirección del destinatario.",
    recommendation: "Verifica que el correo del cliente esté escrito correctamente.",
    attemptStatus: "El mensaje no fue entregado al destinatario.",
    retryable: false,
  },
  PROVIDER_TEMPORARY: {
    title: "No se pudo enviar el correo",
    message: "El servicio de correo no está disponible temporalmente.",
    recommendation: "Intenta enviar el mensaje nuevamente cuando el servicio esté disponible.",
    attemptStatus: "El mensaje no se envió y puede intentarse nuevamente más tarde.",
    retryable: true,
  },
  SEND_LIMIT: {
    title: "No se pudo enviar el correo",
    message: "Se alcanzó temporalmente el límite de correos permitido por el proveedor.",
    recommendation: "Espera antes de realizar nuevos envíos o consulta con el encargado técnico.",
    attemptStatus: "El proveedor rechazó temporalmente este intento de envío.",
    retryable: true,
  },
  UNKNOWN: {
    title: "No se pudo enviar el correo",
    message: "No fue posible completar el envío del correo. El sistema no pudo identificar una causa específica.",
    recommendation: "Verifica el destinatario y comunícate con el encargado técnico si el problema continúa.",
    attemptStatus: "El resultado de este intento de envío no pudo confirmarse.",
    retryable: false,
  },
};

function errorSignals(error: unknown): { code: string; responseCode: number | null; text: string; rejected: boolean } {
  const value = typeof error === "object" && error !== null ? error as MailErrorLike : {};
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : value.message;
  const response = typeof value.response === "string" ? value.response : "";
  const responseCode = typeof value.responseCode === "number" ? value.responseCode : null;
  return {
    code: typeof value.code === "string" ? value.code.toUpperCase() : "",
    responseCode,
    text: `${String(message ?? "")} ${response}`.toLowerCase(),
    rejected: Array.isArray(value.rejected) && value.rejected.length > 0,
  };
}

export function classifyMailError(error: unknown): PublicMailError {
  const signal = errorSignals(error);
  let category: MailErrorCategory = "UNKNOWN";

  if (signal.responseCode === 534 || /application-specific password|required app password|account.*not authorized|authorization required|access blocked/.test(signal.text)) {
    category = "ACCOUNT_AUTHORIZATION";
  } else if (signal.code === "EAUTH" || [530, 535].includes(signal.responseCode ?? 0) || /invalid login|authentication (?:failed|unsuccessful)|username and password not accepted|bad credentials/.test(signal.text)) {
    category = "AUTHENTICATION";
  } else if (/rate limit|too many (?:messages|requests|emails)|sending quota|quota exceeded|daily user sending|limit exceeded/.test(signal.text) || signal.responseCode === 429) {
    category = "SEND_LIMIT";
  } else if (signal.rejected || signal.code === "EENVELOPE" || [550, 551, 553].includes(signal.responseCode ?? 0) || /recipient (?:address )?rejected|mailbox (?:unavailable|not found)|user unknown|no recipients defined|invalid recipient/.test(signal.text)) {
    category = "RECIPIENT_REJECTED";
  } else if (["ECONNECTION", "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "EHOSTUNREACH", "ESOCKET", "EDNS"].includes(signal.code) || /connection (?:refused|timed out|timeout)|network is unreachable|getaddrinfo|socket hang up/.test(signal.text)) {
    category = "CONNECTION";
  } else if ([421, 450, 451, 452].includes(signal.responseCode ?? 0) || /temporar(?:y|ily)|try again later|service unavailable/.test(signal.text)) {
    category = "PROVIDER_TEMPORARY";
  }

  return { category, ...DEFINITIONS[category] };
}

export function sanitizeMailErrorDetail(error: unknown, maxLength = 250): string {
  const value = typeof error === "object" && error !== null ? error as MailErrorLike : {};
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : String(value.message ?? error);
  return detail
    .replace(/(password|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[protegido]")
    .slice(0, maxLength);
}

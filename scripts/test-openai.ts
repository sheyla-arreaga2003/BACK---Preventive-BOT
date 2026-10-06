import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({ quiet: true });

function requireEnvironmentVariable(name: "OPENAI_API_KEY" | "OPENAI_MODEL"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable requerida ${name}.`);
  return value;
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof OpenAI.APIError) {
    const status = error.status ? `HTTP ${error.status}` : "sin estado HTTP";
    return `La API de OpenAI rechazó la solicitud (${status}): ${error.message}`;
  }

  if (error instanceof Error) {
    return `No fue posible completar la solicitud: ${error.message}`;
  }

  return "No fue posible completar la solicitud por un error desconocido.";
}

async function main(): Promise<void> {
  const apiKey = requireEnvironmentVariable("OPENAI_API_KEY");
  const model = requireEnvironmentVariable("OPENAI_MODEL");
  const expectedText = "Conexión exitosa con Preventive Bot.";

  const client = new OpenAI({
    apiKey,
    timeout: 30_000,
    maxRetries: 0,
  });

  const response = await client.responses.create({
    model,
    input: "Responde únicamente: Conexión exitosa con Preventive Bot.",
    max_output_tokens: 256,
    reasoning: { effort: "minimal" },
    store: false,
  });

  const receivedText = response.output_text.trim();
  console.log(`Estado: ${response.status}`);
  console.log(`Texto: ${receivedText || "(vacío)"}`);

  if (response.status !== "completed") {
    const reason = response.incomplete_details?.reason;
    console.error(`Prueba no confirmada: la respuesta no se completó${reason ? ` (${reason})` : ""}.`);
    process.exitCode = 1;
    return;
  }

  if (!receivedText) {
    console.error("Prueba no confirmada: la respuesta se completó sin texto.");
    process.exitCode = 1;
    return;
  }

  if (receivedText !== expectedText) {
    console.error("Prueba no confirmada: el texto recibido no coincide con el solicitado.");
    process.exitCode = 1;
    return;
  }

  console.log("Resultado: conexión comprobada correctamente.");
}

main().catch((error: unknown) => {
  console.error(safeErrorMessage(error));
  process.exitCode = 1;
});

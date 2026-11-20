import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { spawnSync } from "node:child_process";
import { hash, verify } from "@node-rs/argon2";

const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readHidden(prompt: string): Promise<string> {
  if (!input.isTTY || !output.isTTY || process.platform !== "darwin") {
    fail("Este script requiere una terminal interactiva de macOS.");
  }
  const tty = await import("node:fs/promises").then(({ open }) => open("/dev/tty", "r+"));
  const ttyInput = tty.createReadStream();
  const ttyOutput = tty.createWriteStream();
  const readline = createInterface({ input: ttyInput, output: ttyOutput, terminal: true });
  const disableEcho = spawnSync("stty", ["-echo"], { stdio: [ttyInput.fd, ttyOutput.fd, "ignore"] });
  if (disableEcho.status !== 0) {
    readline.close();
    ttyInput.destroy();
    ttyOutput.destroy();
    await tty.close();
    fail("No se pudo ocultar la entrada de contraseña.");
  }
  try {
    const value = await readline.question(prompt);
    ttyOutput.write("\n");
    return value;
  } finally {
    spawnSync("stty", ["echo"], { stdio: [ttyInput.fd, ttyOutput.fd, "ignore"] });
    readline.close();
    ttyInput.destroy();
    ttyOutput.destroy();
    await tty.close();
  }
}

const first = await readHidden("Contraseña nueva (no se mostrará): ");
const confirmation = await readHidden("Confirma la contraseña: ");
if (first.length < 12 || first !== confirmation) fail("La contraseña no coincide o tiene menos de 12 caracteres.");

const generatedHash = await hash(first, ARGON2_OPTIONS);
if (!generatedHash.startsWith("$argon2id$") || !(await verify(generatedHash, first))) {
  fail("No se pudo validar el hash Argon2id.");
}

if (process.platform !== "darwin") fail("La copia segura requiere macOS.");
const copied = spawnSync("pbcopy", { input: generatedHash, encoding: "utf8" });
if (copied.status !== 0) fail("No se pudo copiar el hash al portapapeles.");
console.log("Hash Argon2id generado y copiado al portapapeles. Pégalo únicamente en la variable secreta de Railway y luego borra el portapapeles.");

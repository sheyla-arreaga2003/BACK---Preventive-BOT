import { chromium, request } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RespuestaCapSolver } from "../interfaces/declaraguate.interface.js";
import type { DatosDeclaraguate } from "../interfaces/capsolver.interface.js";

const directorioCapturas = resolve(process.cwd(), 'capturas');

async function resolverCaptcha(imagenBase64: string): Promise<string> {
  const clientKey = 'CAP-9C76A0B9513C17BDC42C7AE1E403561CA12DE60FAA6F279F900ECCB9A6C722F9';

  console.log('Resolviendo CAPTCHA con CapSolver...');

  if (!clientKey) {
    throw new Error('CAPSOLVER_API_KEY no está configurada');
  }

  const contexto = await request.newContext();

  try {
    const response = await contexto.post(
      'https://api.capsolver.com/createTask',
      {
        timeout: 60_000,
        data: {
          clientKey,
          task: {
            type: 'ImageToTextTask',
            module: 'common',
            websiteURL:
              'https://declaraguate.sat.gob.gt/declaraguate-web/',
            body: imagenBase64
          }
        }
      }
    );

    if (!response.ok()) {
      throw new Error(`CapSolver respondió HTTP ${response.status()}`);
    }

    const resultado = (await response.json()) as RespuestaCapSolver;
    const texto = resultado.solution?.text?.trim();

    if (resultado.errorId !== 0 || resultado.status !== 'ready' || !texto) {
      throw new Error(
        resultado.errorDescription ??
          'CapSolver no pudo resolver el CAPTCHA'
      );
    }

    return texto;
  } finally {
    await contexto.dispose();
  }
}

async function esperar(milisegundos: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milisegundos));
}

async function ejecutarIntento(datos: DatosDeclaraguate, numeroIntento: number) {
  await mkdir(directorioCapturas, { recursive: true });

  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  try {
    await page.goto(
      'https://declaraguate.sat.gob.gt/declaraguate-web/',
      { waitUntil: 'domcontentloaded', timeout: 45_000 }
    );

    await page
      .getByRole('link', { name: 'Llenar formulario' })
      .click({ timeout: 30_000 });

    const iframe = page.frameLocator('iframe#iframe');

    await iframe.locator('[id="mainForm:SAT8620"]').click();

    const captcha = iframe.locator('img[src*="/kaptcha.jpg"]');
    await captcha.waitFor({ state: 'visible', timeout: 30_000 });
    await esperar(1_000 * numeroIntento);

    const captura = await captcha.screenshot();
    const solucion = await resolverCaptcha(captura.toString('base64'));

    await iframe.getByRole('textbox').fill(solucion);

    await iframe
      .locator('input[type="submit"][value="Llenar SAT-8620"]')
      .click();

    const marcaTiempo = Date.now();
    const rutaCaptchaExitoso = resolve(
      directorioCapturas,
      `captcha-exitoso-intento-${numeroIntento}-${marcaTiempo}.png`
    );

    await writeFile(rutaCaptchaExitoso, captura);

    const formulario = iframe.locator('form[id="mainForm"]');

    await formulario.waitFor({
        state: 'visible',
        timeout: 30_000 + numeroIntento * 10_000
    });

    if (datos.tipoVehiculo === 'particular') {
      await formulario
        .locator('[id="mainForm:c2:_2"]')
        .check();
    }

    await formulario.locator('[id="mainForm:c5"]').fill(datos.nit);
    await formulario.locator('[id="mainForm:c24"]').fill(datos.marca);
    await formulario.locator('[id="mainForm:c25"]').fill(datos.linea);
    await formulario.locator('[id="mainForm:c26"]').fill(datos.modelo);

    return {
      exitoso: true,
      mensaje: 'Formulario llenado correctamente'
    };
  } catch (error) {
    const rutaError = resolve(
      directorioCapturas,
      `error-intento-${numeroIntento}-${Date.now()}.png`
    );

    await page.screenshot({
      path: rutaError,
      fullPage: true
    });
    console.error(`Captura del error guardada en: ${rutaError}`);
    console.error('Error del intento:', error);

    throw error;
  } finally {
    await browser.close();
  }
}

export async function ejecutarDeclaraguate(datos: DatosDeclaraguate) {
  const maximoIntentos = 3;
  let ultimoError: unknown;

  for (let intento = 1; intento <= maximoIntentos; intento++) {
    try {
      console.log(`Intento ${intento} de ${maximoIntentos} para completar Declaraguate`);
      return await ejecutarIntento(datos, intento);
    } catch (error: unknown) {
      ultimoError = error;

      if (intento < maximoIntentos) {
        await esperar(intento * 2_000);
      }
    }
  }

  throw ultimoError instanceof Error
    ? ultimoError
    : new Error('No se pudo completar Declaraguate después de varios intentos');
}
import { chromium, request } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { RespuestaCapSolver } from "../interfaces/declaraguate.interface.js";
import type { DeclaraguateData } from "../interfaces/capsolver.interface.js";

const snapshotDirectory = resolve(process.cwd(), 'capturas');

async function resolveCaptcha(imagenBase64: string): Promise<string> {
  const clientKey = 'CAP-9C76A0B9513C17BDC42C7AE1E403561CA12DE60FAA6F279F900ECCB9A6C722F9';

  if (!clientKey) {
    throw new Error('CAPSOLVER_API_KEY no está configurada');
  }

  const context = await request.newContext();

  try {
    const response = await context.post(
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
      throw new Error(`CapSolver response HTTP ${response.status()}`);
    }

    const result = (await response.json()) as RespuestaCapSolver;
    const text = result.solution?.text?.trim();

    if (result.errorId !== 0 || result.status !== 'ready' || !text) {
      throw new Error(
        result.errorDescription ??
          'CapSolver captcha solving failed with unknown error'
      );
    }

    return text;
  } finally {
    await context.dispose();
  }
}

async function waiting(miliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, miliseconds));
}

async function executeTry(data: DeclaraguateData, tryNumber: number) {
  await mkdir(snapshotDirectory, { recursive: true });

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
    await waiting(1_000 * tryNumber);
    
    const snapshot = await captcha.screenshot();
    const solution = await resolveCaptcha(snapshot.toString('base64'));

    await iframe.getByRole('textbox').fill(solution);

    await iframe
      .locator('input[type="submit"][value="Llenar SAT-8620"]')
      .click();

    const marcaTiempo = Date.now();
    const rutaCaptchaExitoso = resolve(
      snapshotDirectory,
      `captcha-success-try-${tryNumber}-${marcaTiempo}.png`
    );

    await writeFile(rutaCaptchaExitoso, snapshot);

    const form = iframe.locator('form[id="mainForm"]');

    await form.waitFor({
        state: 'visible',
        timeout: 30_000 + tryNumber * 10_000
    });

    if (data.tipoVehiculo === 'particular') {
      await form
        .locator('[id="mainForm:c2:_2"]')
        .check();
    }

    await form.locator('[id="mainForm:c5"]').fill(data.nit);
    await form.locator('[id="mainForm:c24"]').fill(data.marca);
    await form.locator('[id="mainForm:c25"]').fill(data.linea);
    await form.locator('[id="mainForm:c26"]').fill(data.modelo);

    return {
      result: true,
      message: 'Formulario llenado correctamente'
    };
  } catch (error) {
    const errorRute = resolve(
      snapshotDirectory,
      `error-try-${tryNumber}-${Date.now()}.png`
    );

    await page.screenshot({
      path: errorRute,
      fullPage: true
    });

    throw error;
  } finally {
    await browser.close();
  }
}

export async function executeDeclaraguate(datos: DeclaraguateData): Promise<{ result: boolean; message: string }> {
  const maxTrys = 3;
  let lastError: unknown;

  for (let tryCount = 1; tryCount <= maxTrys; tryCount++) {
    try {
      const result = await executeTry(datos, tryCount);
      return { result: true, message: 'Form filled successfully' };
    } catch (error: unknown) {
      lastError = error;

      if (tryCount < maxTrys) {
        await waiting(tryCount * 2_000);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Declaraguate could not be completed after several attempts');
}
import { chromium, request } from "@playwright/test";
import type { RespuestaCapSolver } from "../interfaces/declaraguate.interface.js";
import type { DatosDeclaraguate } from "../interfaces/capsolver.interface.js";

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

export async function ejecutarDeclaraguate(datos: DatosDeclaraguate) {
  const browser = await chromium.launch({
    headless: true
  });

  const page = await browser.newPage();

  try {
    await page.goto(
      'https://declaraguate.sat.gob.gt/declaraguate-web/',
      { waitUntil: 'domcontentloaded' }
    );

    await page.getByRole('link', { name: 'Llenar formulario' }).click();

    const iframe = page.frameLocator('iframe#iframe');

    await iframe.locator('[id="mainForm:SAT8620"]').click();

    const captcha = iframe.locator('img[src*="/kaptcha.jpg"]');
    await captcha.waitFor({ state: 'visible' });

    const captura = await captcha.screenshot();
    const solucion = await resolverCaptcha(captura.toString('base64'));

    await iframe.getByRole('textbox').fill(solucion);

    await iframe
      .locator('input[type="submit"][value="Llenar SAT-8620"]')
      .click();

    await captcha.waitFor({
      state: 'hidden',
      timeout: 15_000
    });

    const formulario = iframe.locator('form[id="mainForm"]');

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
    await page.screenshot({
      path: `capturas/error-${Date.now()}.png`,
      fullPage: true
    });

    throw error;
  } finally {
    await browser.close();
  }
}
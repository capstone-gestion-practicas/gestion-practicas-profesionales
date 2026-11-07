/** Códigos internos de épica o historia de usuario (EP04, HU06.1…). Solo para documentación y pruebas. */
export const CODIGO_INTERNO = /\b(EP\d{2}|HU\d{2,3}(?:\.\d+)?)\b/;

/**
 * Textos que el usuario lee en pantalla: encabezados, etiquetas, botones, títulos de tarjeta
 * y mensajes. No incluye atributos ni comentarios del código.
 */
export function textosVisibles(raiz: HTMLElement): string[] {
  const selector = 'h1, h2, h3, dt, th, label, p, span, button, ion-button, ion-card-title, ion-label, caption';
  return Array.from(raiz.querySelectorAll(selector))
    .map(elemento => (elemento.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(texto => texto.length > 0);
}

/** Textos visibles que contienen un código interno. Debe devolver una lista vacía. */
export function codigosInternosVisibles(raiz: HTMLElement): string[] {
  return textosVisibles(raiz).filter(texto => CODIGO_INTERNO.test(texto));
}

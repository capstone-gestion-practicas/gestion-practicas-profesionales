import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function limpiarRut(valor: string): string {
  return valor.replace(/\./g, '').replace(/-/g, '').trim().toUpperCase();
}

export function rutValido(valor: string): boolean {
  const limpio = limpiarRut(valor);
  if (!/^\d{7,8}[0-9K]$/.test(limpio)) return false;

  const cuerpo = limpio.slice(0, -1);
  const verificador = limpio.slice(-1);
  let suma = 0;
  let multiplicador = 2;
  for (let indice = cuerpo.length - 1; indice >= 0; indice--) {
    suma += Number(cuerpo[indice]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resultado = 11 - (suma % 11);
  const esperado = resultado === 11 ? '0' : resultado === 10 ? 'K' : String(resultado);
  return verificador === esperado;
}

export function formatearRut(valor: string): string {
  const limpio = limpiarRut(valor);
  if (limpio.length < 2) return limpio;
  const cuerpo = limpio.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cuerpo}-${limpio.slice(-1)}`;
}

export const rutValidator: ValidatorFn = (
  control: AbstractControl<string>
): ValidationErrors | null => {
  const valor = control.value?.trim();
  return !valor || rutValido(valor) ? null : { rut: true };
};

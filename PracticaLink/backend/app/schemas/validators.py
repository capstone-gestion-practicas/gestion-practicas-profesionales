import re


def normalizar_rut(valor: str) -> str:
    limpio = re.sub(r"[.\-]", "", valor.strip()).upper()
    if not re.fullmatch(r"\d{7,8}[0-9K]", limpio):
        raise ValueError("El RUT no tiene un formato válido")

    cuerpo, verificador = limpio[:-1], limpio[-1]
    suma = 0
    multiplicador = 2
    for digito in reversed(cuerpo):
        suma += int(digito) * multiplicador
        multiplicador = 2 if multiplicador == 7 else multiplicador + 1

    resultado = 11 - suma % 11
    esperado = "0" if resultado == 11 else "K" if resultado == 10 else str(resultado)
    if verificador != esperado:
        raise ValueError("El dígito verificador del RUT no es válido")

    cuerpo_formateado = f"{int(cuerpo):,}".replace(",", ".")
    return f"{cuerpo_formateado}-{verificador}"

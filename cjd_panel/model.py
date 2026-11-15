"""Validación de perfiles independiente del transporte y la interfaz."""
from datetime import datetime, timezone


def utcnow():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def integer(value, name, low, high):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"{name}: introduce un entero entre {low} y {high}.")
    return value


def profile(data):
    if not isinstance(data, dict):
        raise ValueError("El perfil debe ser un objeto.")
    name = data.get("name", "")
    notes = data.get("notes", "")
    if not isinstance(name, str) or not name.strip() or len(name) > 120:
        raise ValueError("El nombre es obligatorio y admite hasta 120 caracteres.")
    if not isinstance(notes, str) or len(notes) > 4000:
        raise ValueError("Las notas admiten hasta 4000 caracteres.")
    segments = data.get("segments")
    if not isinstance(segments, list) or len(segments) != 20:
        raise ValueError("Una curva debe contener exactamente 20 puntos C01–C20.")
    clean = []
    for i, s in enumerate(segments, 1):
        if not isinstance(s, dict):
            raise ValueError(f"Punto {i} incorrecto.")
        clean.append({"temperature": integer(s.get("temperature"), f"C{i:02}", 0, 1200),
                      "minutes": integer(s.get("minutes"), f"t{i:02}", 0, 32767)})
    # El tiempo t_i corresponde a C_i -> C_(i+1), no a un mantenimiento implícito.
    if clean[-1]["minutes"] != 0:
        raise ValueError("t20 debe ser 0: el último punto no tiene transición siguiente.")
    if not any(s["minutes"] > 0 for s in clean[:-1]):
        raise ValueError("La curva necesita al menos una transición con tiempo positivo.")
    return {"name": name.strip(), "notes": notes, "segments": clean}

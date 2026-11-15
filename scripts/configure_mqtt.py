"""Extrae SOLO las credenciales MQTT del original como datos, sin ejecutarlo."""
import argparse
import ast
import json
import os
from pathlib import Path


def create(source, destination, host):
    tree = ast.parse(Path(source).read_text())
    values = {}
    names = {'MQTT_USER': 'username', 'MQTT_PASSWORD': 'password', 'MQTT_PORT': 'port'}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1 or not isinstance(node.targets[0], ast.Name):
            continue
        key = names.get(node.targets[0].id)
        if key is None:
            continue
        expression = node.value
        if key == 'port' and isinstance(expression, ast.Call) and isinstance(expression.func, ast.Name) and expression.func.id == 'int':
            expression = expression.args[0]
        if (isinstance(expression, ast.Call) and isinstance(expression.func, ast.Attribute)
                and isinstance(expression.func.value, ast.Name) and expression.func.value.id=='os'
                and expression.func.attr=='getenv' and len(expression.args)==2):
            values[key] = ast.literal_eval(expression.args[1])
        else:
            values[key] = ast.literal_eval(expression)
    if not all(k in values for k in names.values()):
        raise ValueError('No se encontraron todas las credenciales MQTT en el original.')
    values['port'] = int(values['port'])
    values.update(host=host, topic_prefix='horno/cjd9000p', client_id='cjd-control-panel-local',
                  discovery_prefix='homeassistant', device_id='cjd9000p_local', tls=False)
    # Crear exclusivamente: no sobrescribir configuración ya ajustada por el usuario.
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(json.dumps(values, ensure_ascii=False, indent=2)+'\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('.mqtt.json'))
    parser.add_argument('--host', required=True)
    args = parser.parse_args()
    create(args.source, args.output, args.host)
    print('Configuración MQTT privada creada; credenciales no mostradas.')

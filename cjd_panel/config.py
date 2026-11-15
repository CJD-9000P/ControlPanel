"""Configuración local privada del despliegue; nunca se publica mediante la API."""
from dataclasses import asdict, dataclass
import json
from pathlib import Path
from .model import integer


@dataclass(frozen=True)
class PanelConfig:
    host: str = '127.0.0.1'
    port: int = 8080
    mqtt_enabled: bool = False
    auth_required: bool = False
    data_dir: str = 'data'
    mqtt_config: str = '.mqtt.json'
    modbus_config: str = '.modbus.json'
    auth_file: str = '.web-auth.json'

    def __post_init__(self):
        if self.host not in ('127.0.0.1','0.0.0.0','localhost'):
            raise ValueError('Dirección HTTP no compatible.')
        integer(self.port,'Puerto HTTP',1024,65535)
        if type(self.mqtt_enabled) is not bool or type(self.auth_required) is not bool:
            raise ValueError('Opciones de configuración no válidas.')
        for name in ('data_dir','mqtt_config','modbus_config','auth_file'):
            value=getattr(self,name)
            if not isinstance(value,str) or not value or any(c in value for c in '\0\n\r'):
                raise ValueError('Ruta de configuración no válida.')

    def resolve(self,root,name):
        path=Path(getattr(self,name)).expanduser()
        return path if path.is_absolute() else Path(root)/path

    def as_dict(self):return asdict(self)

    @classmethod
    def read(cls,path):
        try:
            file=Path(path)
            if file.stat().st_size>65536:raise ValueError('Archivo demasiado grande')
            return cls(**json.loads(file.read_text()))
        except (OSError,ValueError,TypeError):
            raise ValueError('No se pudo leer la configuración privada del panel.') from None

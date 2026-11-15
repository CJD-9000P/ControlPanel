"""Contraseña web: hash salado, comparación segura y caché limitada de aciertos."""
import base64
from collections import OrderedDict
import hashlib
import hmac
import json
import os
from pathlib import Path
import threading
import time

ITERATIONS=600000


def password_record(password):
    if not isinstance(password,str) or not 8<=len(password)<=1024:
        raise ValueError('La contraseña debe tener entre 8 y 1024 caracteres.')
    salt=os.urandom(16)
    digest=hashlib.pbkdf2_hmac('sha256',password.encode('utf-8'),salt,ITERATIONS)
    return dict(algorithm='pbkdf2_sha256',iterations=ITERATIONS,salt=salt.hex(),digest=digest.hex())


def validate_record(record):
    try:
        if record['algorithm']!='pbkdf2_sha256' or type(record['iterations']) is not int or not 100000<=record['iterations']<=2000000:
            raise ValueError('Hash no compatible')
        if len(bytes.fromhex(record['salt']))!=16 or len(bytes.fromhex(record['digest']))!=32:
            raise ValueError('Hash incompleto')
        return dict(record)
    except (KeyError,TypeError,ValueError):
        raise ValueError('Archivo de contraseña web no válido.') from None


def read_record(path):
    try:
        file=Path(path)
        if file.stat().st_size>4096:raise ValueError('Archivo demasiado grande')
        return validate_record(json.loads(file.read_text()))
    except (OSError,TypeError,ValueError):
        raise ValueError('No se pudo leer la contraseña web configurada.') from None


def supplied_password(header):
    if not isinstance(header,str):return None
    if header.startswith('Bearer '):return header[7:]
    if header.startswith('Basic '):
        try:
            value=base64.b64decode(header[6:],validate=True).decode('utf-8')
            user,sep,password=value.partition(':')
            return password if sep and not user else None
        except (ValueError,UnicodeError):pass
    return None


class PasswordVerifier:
    def __init__(self,record):
        self.record=validate_record(record)
        self.cache=OrderedDict()
        self.lock=threading.Lock()

    def verify(self,candidate):
        if not isinstance(candidate,str) or not 1<=len(candidate)<=1024:return False
        key=hashlib.sha256(candidate.encode('utf-8')).digest()
        now=time.monotonic()
        with self.lock:
            if self.cache.get(key,0)>now:return True
        digest=hashlib.pbkdf2_hmac('sha256',candidate.encode('utf-8'),
            bytes.fromhex(self.record['salt']),self.record['iterations'])
        ok=hmac.compare_digest(digest,bytes.fromhex(self.record['digest']))
        if ok:
            with self.lock:
                self.cache[key]=now+300
                self.cache.move_to_end(key)
                while len(self.cache)>16:self.cache.popitem(last=False)
        return ok

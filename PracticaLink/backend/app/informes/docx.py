"""DOCX-only validation. No HTTP integration and no unsandboxed fallback."""
import hashlib
import importlib.util
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import sysconfig
from functools import lru_cache
from threading import BoundedSemaphore
import time

from fastapi import HTTPException

MAX_BYTES = 10 * 1024 * 1024
WALL_SECONDS = 10
MAX_OUTPUT = 128
_workers = BoundedSemaphore(2)
_NATIVE = {'_struct', 'zlib', 'binascii', '_hashlib', '_blake2', 'math', '_datetime',
           '_bisect', '_random', '_sha2', '_sha512', '_typing', '_socket', 'select',
           '_elementtree', 'pyexpat', '_opcode', '_json', '_heapq', '_csv',
           'unicodedata', 'array', 'resource', '_posixsubprocess', 'fcntl'}


@lru_cache(maxsize=1)
def _runtime_mounts():
    """Relocate the interpreter: no host home, project or complete venv bind."""
    executable = Path(sys.executable).resolve(strict=True)
    stdlib = Path(sysconfig.get_path('stdlib')).resolve(strict=True)
    mounts = [(executable, '/runtime/bin/python')]
    native = [executable]
    for path in sorted(stdlib.iterdir()):
        if path.name in {'site-packages', '__pycache__', 'test', 'ensurepip', 'idlelib',
                         'tkinter', 'turtledemo', 'venv', 'lib-dynload'}:
            continue
        if path.is_dir() or path.suffix == '.py':
            mounts.append((path, '/runtime/lib/python3.12/' + path.name))
    for path in sorted((stdlib / 'lib-dynload').glob('*.so')):
        if path.name.split('.')[0] in _NATIVE:
            mounts.append((path, '/runtime/lib/python3.12/lib-dynload/' + path.name))
            native.append(path)
    for name in ['defusedxml', 'PIL']:
        spec = importlib.util.find_spec(name)
        if spec is None or spec.origin is None:
            raise OSError('Missing validator dependency')
        package = Path(spec.origin).resolve(strict=True).parent
        if name == 'PIL':
            for module in sorted(package.glob('*.py')):
                mounts.append((module, '/deps/PIL/' + module.name))
            for module in sorted(package.glob('_imaging.*.so')):
                mounts.append((module, '/deps/PIL/' + module.name)); native.append(module)
        else:
            mounts.append((package, '/deps/' + name))
    # ldd sees only trusted interpreter/installed libraries and a clean environment.
    result = subprocess.run(['/usr/bin/ldd', *map(str, native)], capture_output=True,
                            text=True, timeout=5, env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    if result.returncode or 'not found' in result.stdout:
        raise OSError('Incomplete native runtime')
    libraries = set()
    for line in result.stdout.splitlines():
        words = line.strip().split()
        candidate = words[2] if len(words) > 2 and words[1] == '=>' else words[0] if words else ''
        if candidate.startswith('/') and not candidate.endswith(':'):
            libraries.add(Path(os.path.abspath(candidate)))
    for path in sorted(libraries):
        if path.name.startswith('libpython3.12'):
            mounts.append((path, '/runtime/lib/' + path.name))
        elif 'pillow.libs' in path.parts:
            mounts.append((path, '/deps/pillow.libs/' + path.name))
        elif str(path).startswith(('/usr/lib/', '/usr/lib64/', '/lib/', '/lib64/')):
            mounts.append((path, str(path)))
        else:
            raise OSError('Unexpected runtime library location')
    loader = Path('/lib64/ld-linux-x86-64.so.2')
    if not loader.exists():
        raise OSError('Unsupported runtime architecture')
    mounts.append((loader.resolve(), str(loader)))
    return tuple(dict.fromkeys(mounts))


def _sandbox_command(worker=None):
    # worker is a trusted internal entrypoint, never a filename supplied by an upload.
    worker = Path(worker or Path(__file__).with_name('docx_worker.py')).resolve(strict=True)
    if not Path('/usr/bin/bwrap').is_file():
        raise OSError('Bubblewrap unavailable')
    command = ['/usr/bin/bwrap', '--unshare-all', '--die-with-parent', '--new-session',
               '--cap-drop', 'ALL', '--clearenv', '--proc', '/proc', '--dev', '/dev',
               '--tmpfs', '/tmp', '--dir', '/worker', '--dir', '/deps',
               '--setenv', 'LD_LIBRARY_PATH', '/runtime/lib:/deps/pillow.libs',
               '--setenv', 'LANG', 'C.UTF-8', '--chdir', '/worker']
    for source, target in _runtime_mounts():
        command += ['--ro-bind', str(source), target]
    command += ['--ro-bind', str(worker), '/worker/docx_worker.py',
                '--', '/runtime/bin/python', '-I', '-B', '-c',
                "import sys; sys.path.insert(0, '/runtime/lib/python3.12/lib-dynload'); "
                "import runpy; runpy.run_path('/worker/docx_worker.py', run_name='__main__')"]
    return command


def _execute(data, worker=None):
    process = None
    output = bytearray()
    try:
        deadline = time.monotonic() + WALL_SECONDS
        process = subprocess.Popen(_sandbox_command(worker), stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                   env={}, close_fds=True, start_new_session=True)
        sent = 0
        with selectors.DefaultSelector() as selector:
            os.set_blocking(process.stdin.fileno(), False)
            os.set_blocking(process.stdout.fileno(), False)
            selector.register(process.stdin, selectors.EVENT_WRITE)
            selector.register(process.stdout, selectors.EVENT_READ)
            while selector.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError
                for key, _ in selector.select(remaining):
                    if key.fileobj is process.stdin:
                        try:
                            sent += os.write(key.fd, memoryview(data)[sent:sent + 65536])
                        except BrokenPipeError:
                            sent = len(data)
                        if sent == len(data):
                            selector.unregister(process.stdin); process.stdin.close()
                    else:
                        block = os.read(key.fd, MAX_OUTPUT + 1 - len(output))
                        if not block:
                            selector.unregister(process.stdout)
                        else:
                            output.extend(block)
                            if len(output) > MAX_OUTPUT:
                                raise OSError('Invalid validator protocol')
            code = process.wait(timeout=max(.01, deadline - time.monotonic()))
        if code == 0 and output == b'READY\nDOCX_OK\n':
            return
        # Bubblewrap may translate a child signal to the shell convention 128+signal.
        if output.startswith(b'READY\n') and (code == 2 or code < 0 or
                code in (128 + signal.SIGKILL, 128 + signal.SIGXCPU)):
            raise HTTPException(422, 'DOCX inválido, no permitido o demasiado complejo')
        raise HTTPException(503, 'Validador DOCX no disponible')
    except (TimeoutError, subprocess.TimeoutExpired):
        status = 422 if output.startswith(b'READY\n') else 503
        raise HTTPException(status, 'No fue posible validar el DOCX dentro de los límites') from None
    except (OSError, ValueError, subprocess.SubprocessError):
        raise HTTPException(503, 'Validador DOCX no disponible') from None
    finally:
        if process is not None:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
            if process.stdout:
                process.stdout.close()


def validar_docx(data: bytes) -> str:
    if not isinstance(data, bytes) or not data:
        raise HTTPException(422, 'El DOCX está vacío o no es válido')
    if len(data) > MAX_BYTES:
        raise HTTPException(413, 'El máximo permitido es 10 MiB')
    if not _workers.acquire(blocking=False):
        raise HTTPException(429, 'Validación DOCX ocupada; vuelve a intentar')
    try:
        _execute(data)
        return hashlib.sha256(data).hexdigest()
    finally:
        _workers.release()

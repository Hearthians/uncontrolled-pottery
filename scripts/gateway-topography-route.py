"""Add only the dedicated Memory Topography proxy route; preserve the main studio."""
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

config = Path('/home/lizd/local/nginx/conf/nginx.conf')
nginx = '/home/lizd/local/nginx/nginx'
prefix = '/home/lizd/local/nginx/'
anchor = '''        location ^~ /pottery/ {
            client_max_body_size 12m;'''
route = '''        location ^~ /pottery/memory-topography/ {
            proxy_pass http://127.0.0.1:15176;
            proxy_http_version 1.1;
            proxy_set_header Host 127.0.0.1:5196;
            proxy_set_header Connection "";
            proxy_connect_timeout 5s;
            proxy_read_timeout 120s;
            add_header X-Content-Type-Options nosniff always;
            add_header Referrer-Policy strict-origin-when-cross-origin always;
        }

'''
original = config.read_text()
if route in original:
    print('Dedicated Memory Topography route is already configured.')
    raise SystemExit(0)
if 'location ^~ /pottery/memory-topography/' in original or original.count(anchor) != 1:
    raise SystemExit('The live routing differs from the inspected configuration; nothing changed.')
backup = config.with_name('nginx.conf.topography-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
with backup.open('x') as stream:
    stream.write(original)
os.chmod(backup, 0o600)
staged = config.with_name('nginx.conf.topography-staged-' + str(os.getpid()))
with staged.open('x') as stream:
    stream.write(original.replace(anchor, route + anchor, 1))
shutil.copymode(config, staged)
try:
    subprocess.run(['sudo', '-n', nginx, '-t', '-c', str(staged), '-p', prefix], check=True)
    if config.read_text() != original:
        raise RuntimeError('The live config changed during staging; nothing replaced.')
    os.replace(staged, config)
    try:
        subprocess.run(['sudo', '-n', nginx, '-t', '-c', str(config), '-p', prefix], check=True)
        subprocess.run(['sudo', '-n', nginx, '-s', 'reload', '-c', str(config), '-p', prefix], check=True)
    except BaseException:
        shutil.copyfile(backup, config)
        subprocess.run(['sudo', '-n', nginx, '-s', 'reload', '-c', str(config), '-p', prefix], check=True)
        raise
    print('Dedicated Memory Topography forwarding enabled. Backup:', backup)
finally:
    staged.unlink(missing_ok=True)

import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

config = Path('/home/lizd/local/nginx/conf/nginx.conf')
nginx = '/home/lizd/local/nginx/nginx'
prefix = '/home/lizd/local/nginx/'
old = '''        location ^~ /pottery/ {
            proxy_pass http://127.0.0.1:15173;
            proxy_http_version 1.1;'''
new = '''        location ^~ /pottery/ {
            client_max_body_size 12m;
            client_body_timeout 30s;
            proxy_request_buffering off;
            access_log off;
            proxy_pass http://127.0.0.1:15174;
            proxy_http_version 1.1;'''
original = config.read_text()
if original.count(old) != 1:
    raise SystemExit('Expected pottery route not found exactly once; no changes made')
backup = config.with_name('nginx.conf.pottery-cutover-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
with backup.open('x') as dest:
    dest.write(original)
os.chmod(backup, 0o600)
tmp = config.with_name('nginx.conf.pottery-staged-' + str(os.getpid()))
with tmp.open('x') as dest:
    dest.write(original.replace(old, new, 1))
shutil.copymode(config, tmp)
try:
    subprocess.run(['sudo', '-n', nginx, '-t', '-c', str(tmp), '-p', prefix], check=True)
    if config.read_text() != original:
        raise RuntimeError('Live config changed after inspection')
    os.replace(tmp, config)
    try:
        subprocess.run(['sudo', '-n', nginx, '-t', '-c', str(config), '-p', prefix], check=True)
        subprocess.run(['sudo', '-n', nginx, '-s', 'reload', '-c', str(config), '-p', prefix], check=True)
    except BaseException:
        shutil.copyfile(backup, config)
        subprocess.run(['sudo', '-n', nginx, '-t', '-c', str(config), '-p', prefix], check=True)
        subprocess.run(['sudo', '-n', nginx, '-s', 'reload', '-c', str(config), '-p', prefix], check=True)
        raise
    print('Pottery route switched. Backup:', backup)
finally:
    tmp.unlink(missing_ok=True)

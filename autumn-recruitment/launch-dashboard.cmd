@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Python environment missing. Follow WINDOWS.md to install first.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" launch_dashboard.py
if errorlevel 1 pause

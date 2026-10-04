@echo off
rem Windows launcher. The real work is done by run.py (venv, install, start server, open browser).
cd /d "%~dp0"
where py >/dev/null 2>nul
if %errorlevel%==0 (
  py -3 run.py %*
  goto :end
)
where python >/dev/null 2>nul
if %errorlevel%==0 (
  python run.py %*
  goto :end
)
echo Python 3.10+ is required. Download: https://www.python.org/downloads/
echo During install, check "Add python.exe to PATH".
:end
pause

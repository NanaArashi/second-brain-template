@echo off
chcp 65001 >nul
setlocal
set "PYTHONIOENCODING=utf-8"
set "PY=%USERPROFILE%\secondbrain-python\python.exe"
if not exist "%PY%" set "PY=python"
cd /d "%~dp0"
"%PY%" run_pipeline.py %*
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (echo [OK] Pipeline finished; inbox cleared.) else (echo [WARN] Some files failed; see log above. Originals stay in inbox.)
pause
endlocal

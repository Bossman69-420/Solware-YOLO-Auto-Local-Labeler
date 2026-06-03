@echo off
setlocal

cd /d "%~dp0"

echo.
echo Starting Solware...
echo.

python --version >nul 2>&1
if errorlevel 1 (
  echo Python was not found. Install Python 3.11 or 3.12 and try again.
  pause
  exit /b 1
)

python -c "import fastapi, uvicorn, ultralytics, PIL" >nul 2>&1
if errorlevel 1 (
  echo Installing Solware requirements...
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Failed to install requirements.
    pause
    exit /b 1
  )
)

echo Opening http://localhost:8000
start "" "http://localhost:8000"

python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

endlocal
@echo off
rem =============================================================================
rem One-click launcher for the AI Proposal Evaluator.
rem
rem Double-click this file (or run `run` from the repo root) to start the
rem whole stack in order:
rem   1. Docker Desktop (started automatically if not running)
rem   2. PostgreSQL + MinIO containers (with health checks)
rem   3. Python AI service   -> http://localhost:8000
rem   4. Node backend        -> http://localhost:3001
rem   5. React frontend      -> http://localhost:5173
rem
rem When everything is up, the app opens in your browser.
rem Stop everything later with: scripts\stop.ps1
rem =============================================================================

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev.ps1" %*

if errorlevel 1 (
    echo.
    echo Startup FAILED - read the error above.
    pause
    exit /b 1
)

start "" http://localhost:5173
echo.
echo All services are running. You can close this window.
pause

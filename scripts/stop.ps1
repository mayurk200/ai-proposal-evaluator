# Stops everything scripts\dev.ps1 started: the three host processes (via the
# recorded PIDs, killing each process tree) and the Docker containers.
#
#   powershell -ExecutionPolicy Bypass -File scripts\stop.ps1

$ErrorActionPreference = 'Continue'

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PidFile  = Join-Path $RepoRoot 'scripts\.dev-pids.json'

if (Test-Path $PidFile) {
    $pids = Get-Content $PidFile -Raw | ConvertFrom-Json
    foreach ($name in @('frontend', 'backend', 'python')) {
        $procId = $pids.$name
        if ($procId) {
            Write-Host "Stopping $name (pid $procId)..."
            # /T kills the whole tree (cmd -> npm -> node / uvicorn workers).
            taskkill /PID $procId /T /F 2>$null | Out-Null
        }
    }
    Remove-Item $PidFile -Force
} else {
    Write-Host "No PID file found ($PidFile) - dev.ps1 processes may not be running."
    Write-Host "If services are still up, close their windows or stop node/python manually."
}

Write-Host "Stopping Docker containers..."
Push-Location $RepoRoot
docker compose stop
Pop-Location

Write-Host "Done."

# =============================================================================
# One-command local development startup for the AI Proposal Evaluator.
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
#
# What it does, in order:
#   1. Verifies prerequisites (Docker engine, Node.js, uv)
#   2. Starts postgres + minio + createbuckets containers and waits for health
#   3. Probes PostgreSQL password auth and SELF-HEALS a stale volume password
#   4. Validates the Python venv (recreates it with uv if broken)
#   5. Installs missing node_modules for backend/frontend
#   6. Starts the Python service, backend, and frontend in their own windows,
#      each gated on the previous one's health endpoint
#
# Compatible with Windows PowerShell 5.1. See docs/setup.md for details.
# =============================================================================

$ErrorActionPreference = 'Stop'

$RepoRoot   = Split-Path -Parent $PSScriptRoot
$PySvcDir   = Join-Path $RepoRoot 'python-service'
$BackendDir = Join-Path $RepoRoot 'backend'
$FrontDir   = Join-Path $RepoRoot 'frontend'
$VenvPython = Join-Path $PySvcDir 'venv\Scripts\python.exe'
$PidFile    = Join-Path $RepoRoot 'scripts\.dev-pids.json'

function Fail($stage, $message) {
    Write-Host ""
    Write-Host "FAILED at stage: $stage" -ForegroundColor Red
    Write-Host $message -ForegroundColor Red
    exit 1
}

function Step($message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Cyan
}

# Minimal .env parser (KEY=VALUE, ignores comments/blank lines).
function Read-DotEnv($path) {
    $result = @{}
    if (Test-Path $path) {
        foreach ($line in Get-Content $path) {
            if ($line -match '^\s*#' -or $line -match '^\s*$') { continue }
            $idx = $line.IndexOf('=')
            if ($idx -gt 0) {
                $key = $line.Substring(0, $idx).Trim()
                $val = $line.Substring($idx + 1).Trim().Trim('"')
                $result[$key] = $val
            }
        }
    }
    return $result
}

function Wait-Http($url, $name, $timeoutSec) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
            if ($resp.StatusCode -eq 200) { return $true }
        } catch {}
        Start-Sleep -Seconds 2
    }
    return $false
}

function Wait-ContainerHealthy($container, $timeoutSec) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $timeoutSec) {
        $status = docker inspect --format '{{.State.Health.Status}}' $container 2>$null
        if ($status -eq 'healthy') { return $true }
        Start-Sleep -Seconds 2
    }
    return $false
}

# A leftover process on a service port would answer our health checks and mask
# the real service (stale code, stale .env). Refuse to start on occupied ports.
function Assert-PortFree($port, $service) {
    $inUse = netstat -ano | Select-String ":$port\s.*LISTENING"
    if ($inUse) {
        $procIds = ($inUse | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique) -join ', '
        Fail 'port check' ("Port $port ($service) is already in use by PID(s) $procIds - a leftover instance from an earlier session?" +
            "`nStop it first (scripts\stop.ps1, close its window, or: taskkill /PID <pid> /T /F) and rerun.")
    }
}

# --- Stage 1: prerequisites -------------------------------------------------
Step "Checking prerequisites"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail 'prerequisites' 'Docker CLI not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/'
}
& { $ErrorActionPreference = 'SilentlyContinue'; docker info *> $null }
if ($LASTEXITCODE -ne 0) {
    # Engine down - try to launch Docker Desktop ourselves and wait for it.
    $dockerDesktop = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
    if (Test-Path $dockerDesktop) {
        Write-Host "  Docker engine not running - starting Docker Desktop..." -ForegroundColor Yellow
        Start-Process $dockerDesktop
        $dockerWait = [System.Diagnostics.Stopwatch]::StartNew()
        while ($dockerWait.Elapsed.TotalSeconds -lt 180) {
            Start-Sleep -Seconds 5
            & { $ErrorActionPreference = 'SilentlyContinue'; docker info *> $null }
            if ($LASTEXITCODE -eq 0) { break }
        }
    }
    & { $ErrorActionPreference = 'SilentlyContinue'; docker info *> $null }
    if ($LASTEXITCODE -ne 0) {
        Fail 'prerequisites' 'Docker engine is not running (auto-start failed or timed out after 180s). Start Docker Desktop manually and retry.'
    }
    Write-Host "  Docker engine ready after $([int]$dockerWait.Elapsed.TotalSeconds)s"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail 'prerequisites' 'Node.js not found. Install Node 20+: https://nodejs.org/'
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    Fail 'prerequisites' ('uv not found. Install it (manages Python independently of the broken system install):' +
        "`n  powershell -ExecutionPolicy ByPass -c `"irm https://astral.sh/uv/install.ps1 | iex`"")
}
if (-not (Test-Path (Join-Path $RepoRoot '.env'))) {
    Fail 'prerequisites' "Root .env not found. Copy .env.example to .env and fill in GROQ_API_KEY / JWT_SECRET."
}
Write-Host "  docker, node, uv, root .env: OK"

$rootEnv = Read-DotEnv (Join-Path $RepoRoot '.env')
$pgUser = $rootEnv['POSTGRES_USER'];     if (-not $pgUser) { $pgUser = 'agrieval' }
$pgPass = $rootEnv['POSTGRES_PASSWORD']; if (-not $pgPass) { $pgPass = 'agrieval123' }
$pgDb   = $rootEnv['POSTGRES_DB'];       if (-not $pgDb)   { $pgDb   = 'agrieval' }

# --- Stage 2: docker containers ----------------------------------------------
Step "Starting Docker containers (postgres, minio, createbuckets)"

Push-Location $RepoRoot
docker compose up -d postgres minio createbuckets
$composeExit = $LASTEXITCODE
Pop-Location
if ($composeExit -ne 0) { Fail 'docker compose' 'docker compose up failed - see output above.' }

if (-not (Wait-ContainerHealthy 'agrieval-postgres' 120)) {
    Fail 'postgres health' 'agrieval-postgres did not become healthy in 120s. Check: docker logs agrieval-postgres'
}
Write-Host "  agrieval-postgres: healthy"
if (-not (Wait-ContainerHealthy 'agrieval-minio' 120)) {
    Fail 'minio health' 'agrieval-minio did not become healthy in 120s. Check: docker logs agrieval-minio'
}
Write-Host "  agrieval-minio: healthy"

# createbuckets is a one-shot container: wait for exit code 0.
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$bucketsOk = $false
while ($sw.Elapsed.TotalSeconds -lt 60) {
    $state = docker inspect --format '{{.State.Status}}:{{.State.ExitCode}}' agrieval-createbuckets 2>$null
    if ($state -eq 'exited:0') { $bucketsOk = $true; break }
    if ($state -like 'exited:*') { break }
    Start-Sleep -Seconds 2
}
if (-not $bucketsOk) {
    Fail 'createbuckets' 'Bucket initialization container did not finish cleanly. Check: docker logs agrieval-createbuckets'
}
Write-Host "  createbuckets: done (bucket ready)"

# --- Stage 3: PostgreSQL auth probe + self-heal ------------------------------
# POSTGRES_PASSWORD only applies when the volume is first created; if the
# volume predates a password change, password auth fails even though the
# container is healthy. Probe real TCP+password auth (container's own IP so
# pg_hba's scram rule applies, not local trust) and reset the password over
# the trusted local socket if it fails.
Step "Verifying PostgreSQL password authentication"

$pgIp = docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' agrieval-postgres
docker exec -e PGPASSWORD=$pgPass agrieval-postgres psql -h $pgIp -U $pgUser -d $pgDb -c 'select 1' *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Password auth FAILED (stale volume password) - self-healing..." -ForegroundColor Yellow
    $alter = "ALTER USER `"$pgUser`" WITH PASSWORD '$pgPass';"
    docker exec agrieval-postgres psql -U $pgUser -d $pgDb -c $alter | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Fail 'postgres auth' "Could not reset the password for '$pgUser'. Check: docker logs agrieval-postgres"
    }
    docker exec -e PGPASSWORD=$pgPass agrieval-postgres psql -h $pgIp -U $pgUser -d $pgDb -c 'select 1' *> $null
    if ($LASTEXITCODE -ne 0) {
        Fail 'postgres auth' 'Password auth still failing after reset. See docs/setup.md "Password reset".'
    }
    Write-Host "  Password reset to match .env: OK" -ForegroundColor Green
} else {
    Write-Host "  Password auth: OK"
}

# --- Stage 4: Python virtual environment -------------------------------------
Step "Validating Python environment (python-service\venv)"

$venvOk = $false
if (Test-Path $VenvPython) {
    & $VenvPython -c "import fastapi, uvicorn, sqlalchemy, asyncpg, boto3, pydantic_settings" 2>$null
    if ($LASTEXITCODE -eq 0) { $venvOk = $true }
}
if (-not $venvOk) {
    Write-Host "  venv missing or broken - recreating with uv (Python 3.11)..." -ForegroundColor Yellow
    Push-Location $PySvcDir
    if (Test-Path 'venv') { Remove-Item -Recurse -Force 'venv' }
    uv venv venv --python 3.11
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'python venv' 'uv venv failed - see output above.' }
    uv pip install -r requirements.txt --python .\venv\Scripts\python.exe
    if ($LASTEXITCODE -ne 0) { Pop-Location; Fail 'python deps' 'uv pip install failed - see output above.' }
    Pop-Location
    & $VenvPython -c "import fastapi, uvicorn, sqlalchemy, asyncpg, boto3, pydantic_settings"
    if ($LASTEXITCODE -ne 0) { Fail 'python venv' 'Recreated venv still cannot import required packages.' }
}
Write-Host "  venv: OK ($(& $VenvPython --version))"

# --- Stage 5: node_modules ----------------------------------------------------
Step "Checking Node dependencies"

foreach ($dir in @($BackendDir, $FrontDir)) {
    if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
        Write-Host "  Installing dependencies in $dir..."
        Push-Location $dir
        npm install
        $npmExit = $LASTEXITCODE
        Pop-Location
        if ($npmExit -ne 0) { Fail 'npm install' "npm install failed in $dir" }
    }
}
Write-Host "  node_modules: OK"

# --- Stage 6: start services --------------------------------------------------
$pids = @{}

Step "Checking service ports are free"
Assert-PortFree 8000 'Python service'
Assert-PortFree 3001 'backend'
Assert-PortFree 5173 'frontend'
Write-Host "  ports 8000, 3001, 5173: free"

Step "Starting Python service (http://localhost:8000)"
$py = Start-Process -FilePath $VenvPython `
    -ArgumentList '-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000' `
    -WorkingDirectory $PySvcDir -PassThru
$pids['python'] = $py.Id
if (-not (Wait-Http 'http://localhost:8000/api/v1/health' 'python-service' 120)) {
    Fail 'python service' ('Python service did not become healthy in 120s. ' +
        'Its window shows the preflight PASS/FAIL report explaining exactly which dependency failed.')
}
Write-Host "  Python service: healthy"

Step "Starting backend (http://localhost:3001)"
$be = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm run dev' `
    -WorkingDirectory $BackendDir -PassThru
$pids['backend'] = $be.Id
if (-not (Wait-Http 'http://localhost:3001/api/health' 'backend' 90)) {
    Fail 'backend' 'Backend did not become healthy in 90s - check its window for the startup readiness summary.'
}
Write-Host "  Backend: healthy"

Step "Starting frontend (http://localhost:5173)"
$fe = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c','npm run dev' `
    -WorkingDirectory $FrontDir -PassThru
$pids['frontend'] = $fe.Id
if (-not (Wait-Http 'http://localhost:5173' 'frontend' 90)) {
    Fail 'frontend' 'Frontend dev server did not respond in 90s - check its window.'
}
Write-Host "  Frontend: up"

$pids | ConvertTo-Json | Set-Content -Path $PidFile -Encoding ASCII

Write-Host ""
Write-Host "=============================================================" -ForegroundColor Green
Write-Host " All services are up." -ForegroundColor Green
Write-Host "   Frontend:       http://localhost:5173"
Write-Host "   Backend API:    http://localhost:3001/api/health"
Write-Host "   Python service: http://localhost:8000/api/v1/health"
Write-Host "   MinIO console:  http://localhost:9001  (minioadmin / minioadmin)"
Write-Host "   PostgreSQL:     localhost:5432  ($pgUser / db: $pgDb)"
Write-Host ""
Write-Host " Stop everything:  powershell -ExecutionPolicy Bypass -File scripts\stop.ps1"
Write-Host "=============================================================" -ForegroundColor Green

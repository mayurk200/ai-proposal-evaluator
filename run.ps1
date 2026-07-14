#Requires -Version 5.1
<#
.SYNOPSIS
    AgriEval — start the whole system with one command.

.DESCRIPTION
    .\run.ps1              start everything (installs what's missing on first run)
    .\run.ps1 -Stop        stop the services and the containers
    .\run.ps1 -Clean       stop, and DESTROY the database and stored files
    .\run.ps1 -Setup       install dependencies and prepare, but do not start
    .\run.ps1 -NoDocker    use a Postgres you are already running yourself

    Ctrl+C stops everything cleanly.

.NOTES
    If PowerShell refuses to run this, it is the execution policy, not the script:
        Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
#>
[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$Clean,
    [switch]$Setup,
    [switch]$NoDocker
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
$Root = $PSScriptRoot
$Logs = Join-Path $Root '.logs'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null

# ---------------------------------------------------------------------------
# Output
#
# The tick is built from its code point rather than pasted in: PowerShell 5.1 reads
# scripts as ANSI unless there is a BOM, and a literal ✓ turns into mojibake. Note also
# that `Write-Host [char]0x2713` does NOT work — in argument-parsing mode that is the
# literal string "[char]0x2713" — so it has to go through a variable.
# ---------------------------------------------------------------------------
$script:Tick = [string][char]0x2713

function Write-Step { param([string]$m) Write-Host ''; Write-Host '==> ' -ForegroundColor Blue -NoNewline; Write-Host $m -ForegroundColor White }
function Write-Ok   { param([string]$m) Write-Host '    ' -NoNewline; Write-Host $script:Tick -ForegroundColor Green -NoNewline; Write-Host " $m" }
function Write-Warn { param([string]$m) Write-Host '    ' -NoNewline; Write-Host '!' -ForegroundColor Yellow -NoNewline; Write-Host " $m" }
function Write-Info { param([string]$m) Write-Host "    $m" -ForegroundColor DarkGray }
function Write-Die  { param([string]$m) Write-Host ''; Write-Host 'error: ' -ForegroundColor Red -NoNewline; Write-Host $m; Write-Host ''; exit 1 }

$script:Procs = @()

# ---------------------------------------------------------------------------
# docker compose — the v2 plugin and the v1 standalone binary take different argv.
#
# Arguments are passed as an explicit array, not as remaining-arguments. Flags like
# `-T` and `-d` would otherwise be parsed as parameters of THIS function rather than
# forwarded to docker.
# ---------------------------------------------------------------------------
$script:DockerCompose = $null
function Invoke-Compose {
    param([Parameter(Mandatory)] [string[]]$ComposeArgs)
    if ($script:DockerCompose -eq 'plugin') { & docker compose @ComposeArgs }
    else { & docker-compose @ComposeArgs }
}

function Resolve-Compose {
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        & docker compose version *>$null
        if ($LASTEXITCODE -eq 0) { $script:DockerCompose = 'plugin'; return $true }
    }
    if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
        $script:DockerCompose = 'standalone'; return $true
    }
    return $false
}

# ---------------------------------------------------------------------------
# Shutdown
# ---------------------------------------------------------------------------
function Stop-Services {
    foreach ($p in $script:Procs) {
        if ($p -and -not $p.HasExited) {
            # Kill the whole tree: npm/npx and uvicorn both spawn children that would
            # otherwise survive and keep the ports bound.
            & taskkill /PID $p.Id /T /F *>$null
        }
    }
    $script:Procs = @()
}

function Stop-All {
    param([switch]$Destroy)

    Write-Step 'Stopping'
    Stop-Services

    Get-Process -Name 'python','node' -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -and $_.Path.StartsWith($Root) } |
        ForEach-Object { & taskkill /PID $_.Id /T /F *>$null }
    Write-Ok 'services stopped'

    if (-not $NoDocker -and (Resolve-Compose)) {
        if ($Destroy) {
            Invoke-Compose @('down','-v') *>$null
            Write-Ok 'containers and volumes destroyed'
            Remove-Item -Recurse -Force (Join-Path $Root 'python-service\uploads') -ErrorAction SilentlyContinue
            Remove-Item -Recurse -Force $Logs -ErrorAction SilentlyContinue
            Write-Ok 'stored files removed'
            Write-Warn 'the database is gone — the next run starts from empty'
        } else {
            Invoke-Compose @('down') *>$null
            Write-Ok 'containers stopped (data kept)'
        }
    }
    Write-Host ''
}

if ($Stop -or $Clean) { Stop-All -Destroy:$Clean; exit 0 }

# Ctrl+C must not leave orphaned servers holding the ports.
[Console]::TreatControlCAsInput = $false
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Stop-Services } | Out-Null

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
Write-Step 'Checking prerequisites'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Die "Node.js is not installed. Need v18+: https://nodejs.org"
}
$nodeMajor = [int]((node -p 'process.versions.node.split(".")[0]'))
if ($nodeMajor -lt 18) { Write-Die "Node.js $(node -v) is too old. Need v18 or newer." }
Write-Ok "node $(node -v)"

$Py = $null
foreach ($c in @('python', 'python3', 'py')) {
    if (Get-Command $c -ErrorAction SilentlyContinue) {
        try {
            $v = & $c -c 'import sys; print("%d.%d" % sys.version_info[:2])' 2>$null
            if ($v -match '^3\.(\d+)$' -and [int]$Matches[1] -ge 11) { $Py = $c; break }
        } catch { }
    }
}
if (-not $Py) {
    Write-Die "Python 3.11+ is not installed, or it is the Microsoft Store stub.
Install from https://www.python.org/downloads/ and tick 'Add python.exe to PATH'."
}
Write-Ok "python $(& $Py -V 2>&1 | ForEach-Object { $_ -replace 'Python ','' }) ($Py)"

if (-not $NoDocker) {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Die "Docker Desktop is not installed. https://docs.docker.com/desktop/install/windows-install/
(Or run with -NoDocker if you have your own Postgres with the pgvector extension.)"
    }
    & docker info *>$null
    if ($LASTEXITCODE -ne 0) { Write-Die 'Docker is installed but not running. Start Docker Desktop.' }
    if (-not (Resolve-Compose)) { Write-Die "Neither 'docker compose' nor 'docker-compose' is available." }
    Write-Ok 'docker is running'
}

if (Get-Command tesseract -ErrorAction SilentlyContinue) {
    Write-Ok 'tesseract found'
} else {
    Write-Warn "tesseract is not on PATH — scanned PDFs and images will not be OCR'd."
    Write-Info 'install: https://github.com/UB-Mannheim/tesseract/wiki'
    Write-Info 'then set TESSERACT_CMD in .env if it is still not on PATH'
}

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
Write-Step 'Configuration'

$EnvFile = Join-Path $Root '.env'
if (-not (Test-Path $EnvFile)) {
    Copy-Item (Join-Path $Root '.env.example') $EnvFile
    Write-Warn 'created .env from .env.example'
    Write-Die "Set GROQ_API_KEY in .env, then run this again.
Get a key at https://console.groq.com/keys"
}

$cfg = @{}
Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
        $k, $v = $line.Split('=', 2)
        $cfg[$k.Trim()] = $v.Trim().Trim('"').Trim("'")
    }
}

function Cfg { param([string]$k, [string]$default = '')
    if ($cfg.ContainsKey($k) -and $cfg[$k]) { return $cfg[$k] } else { return $default }
}

$GroqKey = Cfg 'GROQ_API_KEY'
if (-not $GroqKey) {
    Write-Die "GROQ_API_KEY is empty in .env
Get a key at https://console.groq.com/keys"
}

$FrontendPort = Cfg 'FRONTEND_PORT' '5173'
$GatewayPort  = Cfg 'GATEWAY_PORT'  '3001'
$PythonPort   = Cfg 'PYTHON_PORT'   '8000'
$PgUser       = Cfg 'POSTGRES_USER' 'agrieval'
$PgPass       = Cfg 'POSTGRES_PASSWORD' 'agrieval123'
$PgDb         = Cfg 'POSTGRES_DB'   'agrieval'
$PgPort       = Cfg 'POSTGRES_PORT' '5432'
$Storage      = Cfg 'STORAGE_PROVIDER' 'local'
$MinioPort    = Cfg 'MINIO_PORT' '9000'
$Tpm          = Cfg 'LLM_TPM' '12000'
$TpmFast      = Cfg 'LLM_TPM_FAST' '6000'
$JwtSecret    = Cfg 'JWT_SECRET' 'change-this-to-a-long-random-string'
$AdminEmail   = Cfg 'ADMIN_EMAIL' 'admin@agrieval.local'
$AdminPass    = Cfg 'ADMIN_PASSWORD' 'ChangeMe!Admin1'
$Desk2Email   = Cfg 'DESK2_EMAIL' 'desk2@agrieval.local'
$Desk2Pass    = Cfg 'DESK2_PASSWORD' 'ChangeMe!Desk2'
$TesseractCmd = Cfg 'TESSERACT_CMD'

Write-Ok 'loaded .env'

# The two services read their own .env files. Generate them from the root one so there
# is exactly one place to edit and no chance of the three drifting apart.
$pyEnv = @"
# GENERATED by run.ps1 from the root .env — do not edit; your changes will be overwritten.
PORT=$PythonPort
ENV=development
LOG_LEVEL=$(Cfg 'LOG_LEVEL' 'INFO')

GROQ_API_KEY=$GroqKey
LLM_MODEL=llama-3.3-70b-versatile
LLM_MODEL_FAST=llama-3.1-8b-instant
LLM_TPM=$Tpm
LLM_TPM_FAST=$TpmFast

DATABASE_URL=postgresql+asyncpg://${PgUser}:${PgPass}@localhost:${PgPort}/${PgDb}

STORAGE_PROVIDER=$Storage
STORAGE_LOCAL_DIR=./uploads
S3_BUCKET_NAME=$(Cfg 'S3_BUCKET_NAME' 'agrieval-uploads')
S3_ACCESS_KEY=$(Cfg 'MINIO_ROOT_USER' 'minioadmin')
S3_SECRET_KEY=$(Cfg 'MINIO_ROOT_PASSWORD' 'minioadmin')
S3_ENDPOINT_URL=http://localhost:$MinioPort
S3_REGION=us-east-1

OCR_ENABLED=true
OCR_LANGUAGE=eng
"@
if ($TesseractCmd) { $pyEnv += "`nTESSERACT_CMD=$TesseractCmd" }
Set-Content -Path (Join-Path $Root 'python-service\.env') -Value $pyEnv -Encoding ASCII

$nodeEnv = @"
# GENERATED by run.ps1 from the root .env — do not edit; your changes will be overwritten.
NODE_ENV=development
PORT=$GatewayPort
JWT_SECRET=$JwtSecret

# The gateway uses the plain URL; the Python service uses +asyncpg.
DATABASE_URL=postgresql://${PgUser}:${PgPass}@localhost:${PgPort}/${PgDb}
PYTHON_SERVICE_URL=http://localhost:$PythonPort

ADMIN_EMAIL=$AdminEmail
ADMIN_PASSWORD=$AdminPass
DESK2_EMAIL=$Desk2Email
DESK2_PASSWORD=$Desk2Pass

STORAGE_PROVIDER=$Storage
MAX_FILE_SIZE=52428800
"@
Set-Content -Path (Join-Path $Root 'backend\.env') -Value $nodeEnv -Encoding ASCII

Write-Ok 'generated backend\.env and python-service\.env'

if ($AdminPass.StartsWith('ChangeMe!') -or $Desk2Pass.StartsWith('ChangeMe!')) {
    Write-Warn 'using the default operator passwords — change them in .env before deploying'
}

# ---------------------------------------------------------------------------
# Infrastructure
# ---------------------------------------------------------------------------
if (-not $NoDocker) {
    Write-Step 'Starting Postgres'

    $services = @('postgres')
    if ($Storage -eq 'minio') { $services += 'minio' }

    Invoke-Compose (@('up','-d') + $services) *>$null
    if ($LASTEXITCODE -ne 0) { Write-Die 'docker compose failed to start.' }

    Write-Host '    waiting for postgres' -NoNewline
    $ready = $false
    foreach ($i in 1..60) {
        Invoke-Compose @('exec','-T','postgres','pg_isready','-U',$PgUser,'-d',$PgDb) *>$null
        if ($LASTEXITCODE -eq 0) { $ready = $true; break }

        # A crash-looping container will never become ready, and waiting the full minute
        # to say so is unkind. The overwhelmingly common cause is a data directory left
        # by an older Postgres major version, so name it rather than making the user go
        # and read docker logs.
        $pgLogs = (& docker logs agrieval-postgres 2>&1 | Select-Object -Last 20) -join "`n"
        if ($pgLogs -match 'are incompatible with server') {
            Write-Host "`r" -NoNewline
            $oldVer = if ($pgLogs -match 'initialized by PostgreSQL version (\d+)') { $Matches[1] } else { 'an older version' }
            Write-Die @"
Postgres cannot start: the existing database volume was created by
PostgreSQL $oldVer, and this image is PostgreSQL 16.

This is expected if you ran an earlier version of AgriEval, which used
postgres:15-alpine. That image has no pgvector extension, so the duplicate-idea
gate cannot work against it — hence the upgrade.

To reset the database and start clean:

    .\run.ps1 -Clean ; .\run.ps1

This DESTROYS the existing database. Note that the old schema is not compatible
with this one, so old rows cannot be imported as-is.
"@
        }

        Write-Host '.' -NoNewline
        Start-Sleep -Seconds 1
    }
    Write-Host "`r" -NoNewline
    if (-not $ready) { Write-Die 'postgres did not become ready. Try: docker logs agrieval-postgres' }
    Write-Ok "postgres ready on :$PgPort                              "

    # The similarity gate is an HNSW index over a vector column, so pgvector is not
    # optional. Fail here, clearly, rather than deep inside a CREATE TABLE.
    Invoke-Compose @('exec','-T','postgres','psql','-U',$PgUser,'-d',$PgDb,'-c','CREATE EXTENSION IF NOT EXISTS vector') *>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Die "This Postgres does not have the pgvector extension.
docker-compose.yml pins pgvector/pgvector:pg16 for exactly this reason — do not
swap it for a stock postgres image."
    }
    Write-Ok 'pgvector extension available'

    if ($Storage -eq 'minio') { Write-Ok "minio on :$MinioPort" }
} else {
    Write-Info "skipping docker — expecting Postgres at localhost:$PgPort"
}

# ---------------------------------------------------------------------------
# Python service
# ---------------------------------------------------------------------------
Write-Step 'Python AI service'

$PySvc = Join-Path $Root 'python-service'
$Venv  = Join-Path $PySvc 'venv'
$VPy   = Join-Path $Venv  'Scripts\python.exe'
$Stamp = Join-Path $Venv  '.requirements.sha'
$Warm  = Join-Path $Venv  '.models-warmed'

Push-Location $PySvc

if (-not (Test-Path $VPy)) {
    Write-Info 'creating virtualenv (first run)'
    & $Py -m venv venv
    if (-not (Test-Path $VPy)) { Write-Die 'could not create the virtualenv.' }
}

$reqSha = (Get-FileHash 'requirements.txt' -Algorithm SHA256).Hash
$haveSha = if (Test-Path $Stamp) { Get-Content $Stamp -Raw } else { '' }

# Only reinstall when requirements.txt actually changed. pip is slow, and this script
# is meant to be run every day.
if ($haveSha.Trim() -ne $reqSha) {
    Write-Info 'installing python dependencies (a few minutes on first run)'
    & $VPy -m pip install --quiet --upgrade pip
    & $VPy -m pip install --quiet -r requirements.txt
    if ($LASTEXITCODE -ne 0) { Pop-Location; Write-Die 'pip install failed. See the output above.' }
    Set-Content -Path $Stamp -Value $reqSha
    Write-Ok 'dependencies installed'
} else {
    Write-Ok 'dependencies up to date'
}

# tiktoken fetches its encoding over the network on first use and fastembed downloads a
# ~130MB model. Doing it here — with a message — beats the user's first upload hanging.
if (-not (Test-Path $Warm)) {
    Write-Info 'downloading tokenizer and embedding model (one time, ~130MB)'
    $warmScript = @'
import tiktoken
tiktoken.get_encoding("cl100k_base").encode("warm")
from fastembed import TextEmbedding
list(TextEmbedding(model_name="BAAI/bge-small-en-v1.5").embed(["warm"]))
'@
    $warmFile = Join-Path $env:TEMP 'agrieval_warm.py'
    Set-Content -Path $warmFile -Value $warmScript
    & $VPy $warmFile *>$null
    if ($LASTEXITCODE -eq 0) { New-Item -ItemType File -Path $Warm -Force | Out-Null; Write-Ok 'models cached' }
    else { Write-Warn 'model pre-warm failed; the first upload will be slower' }
    Remove-Item $warmFile -ErrorAction SilentlyContinue
}

Pop-Location

if ($Setup) {
    Push-Location (Join-Path $Root 'backend');  & npm install --silent; Pop-Location
    Push-Location (Join-Path $Root 'frontend'); & npm install --silent; Pop-Location
    Write-Step 'Setup complete'
    Write-Info 'run .\run.ps1 to start'
    exit 0
}

# The Python service owns the schema. It must be up — and have created the tables —
# before the gateway's seed script can insert users.
$env:PYTHONPATH = $PySvc
$pyLog = Join-Path $Logs 'python.log'
$script:Procs += Start-Process -FilePath $VPy `
    -ArgumentList '-m','uvicorn','app.main:app','--host','0.0.0.0','--port',$PythonPort `
    -WorkingDirectory $PySvc -RedirectStandardOutput $pyLog -RedirectStandardError "$pyLog.err" `
    -NoNewWindow -PassThru

function Wait-Url {
    param([string]$Url, [int]$Seconds = 60)
    foreach ($i in 1..$Seconds) {
        try {
            Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
            return $true
        } catch {
            # A 503 still means the process is up and answering.
            if ($_.Exception.Response) { return $true }
        }
        Write-Host '.' -NoNewline
        Start-Sleep -Seconds 1
    }
    return $false
}

Write-Host '    waiting for the AI service' -NoNewline
if (-not (Wait-Url "http://localhost:$PythonPort/api/v1/health" 90)) {
    Write-Host "`r" -NoNewline
    Get-Content $pyLog -Tail 25 -ErrorAction SilentlyContinue
    Get-Content "$pyLog.err" -Tail 25 -ErrorAction SilentlyContinue
    Stop-Services
    Write-Die "the AI service did not start. Full log: $pyLog"
}
Write-Host "`r" -NoNewline
Write-Ok "AI service ready on :$PythonPort                    "

# ---------------------------------------------------------------------------
# Gateway
# ---------------------------------------------------------------------------
Write-Step 'API gateway'

$Backend = Join-Path $Root 'backend'
Push-Location $Backend

if (-not (Test-Path 'node_modules')) {
    Write-Info 'installing node dependencies'
    & npm install --silent
    if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-Services; Write-Die 'npm install failed in backend\' }
}
Write-Ok 'dependencies ready'

# Idempotent: upserts by email, never resets a password that has been changed.
Write-Info 'seeding operator accounts'
& npm run seed 2>&1 | Select-String -Pattern 'created|exists|updated|WARNING' | ForEach-Object { Write-Host "    $_" }

$gwLog = Join-Path $Logs 'gateway.log'
$script:Procs += Start-Process -FilePath 'npx.cmd' -ArgumentList 'tsx','src/server.ts' `
    -WorkingDirectory $Backend -RedirectStandardOutput $gwLog -RedirectStandardError "$gwLog.err" `
    -NoNewWindow -PassThru

Pop-Location

Write-Host '    waiting for the gateway' -NoNewline
if (-not (Wait-Url "http://localhost:$GatewayPort/api/health" 40)) {
    Write-Host "`r" -NoNewline
    Get-Content $gwLog -Tail 25 -ErrorAction SilentlyContinue
    Stop-Services
    Write-Die "the gateway did not start. Full log: $gwLog"
}
Write-Host "`r" -NoNewline
Write-Ok "gateway ready on :$GatewayPort                      "

# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------
Write-Step 'Frontend'

$Frontend = Join-Path $Root 'frontend'
Push-Location $Frontend

if (-not (Test-Path 'node_modules')) {
    Write-Info 'installing node dependencies'
    & npm install --silent
    if ($LASTEXITCODE -ne 0) { Pop-Location; Stop-Services; Write-Die 'npm install failed in frontend\' }
}
Write-Ok 'dependencies ready'

$feLog = Join-Path $Logs 'frontend.log'
$script:Procs += Start-Process -FilePath 'npx.cmd' -ArgumentList 'vite','--port',$FrontendPort,'--host' `
    -WorkingDirectory $Frontend -RedirectStandardOutput $feLog -RedirectStandardError "$feLog.err" `
    -NoNewWindow -PassThru

Pop-Location

Write-Host '    waiting for the frontend' -NoNewline
if (-not (Wait-Url "http://localhost:$FrontendPort" 40)) {
    Write-Host "`r" -NoNewline
    Get-Content $feLog -Tail 25 -ErrorAction SilentlyContinue
    Stop-Services
    Write-Die "the frontend did not start. Full log: $feLog"
}
Write-Host "`r" -NoNewline
Write-Ok "frontend ready on :$FrontendPort                    "

# ---------------------------------------------------------------------------
# Ready
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host 'AgriEval is running.' -ForegroundColor Green
Write-Host ''
Write-Host "    Open  http://localhost:$FrontendPort" -ForegroundColor White
Write-Host ''
Write-Host "    gateway   http://localhost:$GatewayPort/api/health" -ForegroundColor DarkGray
Write-Host "    AI docs   http://localhost:$PythonPort/docs"        -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Sign in' -ForegroundColor White
Write-Host "    admin   $AdminEmail   $AdminPass"
Write-Host '    decides: duplicate gate, approve/reject, funding' -ForegroundColor DarkGray
Write-Host "    desk2   $Desk2Email   $Desk2Pass"
Write-Host '    uploads, processes, retries, reads — cannot decide' -ForegroundColor DarkGray
Write-Host ''
Write-Host "  logs      $Logs\{python,gateway,frontend}.log" -ForegroundColor DarkGray
Write-Host "  stop      Ctrl+C  (containers keep running; '.\run.ps1 -Stop' stops those too)" -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Note: ' -ForegroundColor Yellow -NoNewline
Write-Host 'on Groq''s free tier an evaluation takes ~4 minutes — nearly all of it'
Write-Host '  waiting on the token budget. Raise LLM_TPM in .env when you raise your tier.'
Write-Host ''

# Hold the console open. Ctrl+C lands in the finally block.
try {
    while ($true) {
        Start-Sleep -Seconds 1
        foreach ($p in $script:Procs) {
            if ($p -and $p.HasExited) {
                Write-Warn "a service exited unexpectedly (pid $($p.Id)) — check $Logs"
                throw 'service died'
            }
        }
    }
} finally {
    Write-Host ''
    Write-Step 'Shutting down'
    Stop-Services
    Write-Ok 'services stopped'
    Write-Info "containers are still running — '.\run.ps1 -Stop' to stop them too"
}

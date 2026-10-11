param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$centerRoot = $PSScriptRoot
$centerApp = Join-Path $centerRoot 'app.py'
$canvasPython = Join-Path $centerRoot 'vendor\canvas-mcp\.venv\Scripts\python.exe'
$listener = Get-NetTCPConnection -LocalPort 8768 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    $running = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener[0].OwningProcess)"
    if (-not $running.CommandLine.Contains($centerApp)) { throw 'Port 8768 belongs to another service.' }
} else {
    if (-not (Test-Path -LiteralPath $canvasPython)) { throw 'Run .\setup.ps1 first.' }
    Start-Process -FilePath $canvasPython -ArgumentList ('"' + $centerApp + '"') -WorkingDirectory $centerRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $centerRoot 'service.stdout.log') -RedirectStandardError (Join-Path $centerRoot 'service.stderr.log') | Out-Null
}
$ready = $false
for ($retry=0; $retry -lt 30; $retry++) {
    try { $page = Invoke-WebRequest 'http://127.0.0.1:8768/' -TimeoutSec 2; if ($page.StatusCode -eq 200) { $ready=$true; break } } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $ready) { throw 'Startup failed. Check service.stderr.log locally.' }
Write-Output 'Student Center: http://127.0.0.1:8768/'
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8768/' }

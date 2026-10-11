$ErrorActionPreference = 'Stop'
$listener = Get-NetTCPConnection -LocalPort 8768 -State Listen -ErrorAction SilentlyContinue
if (-not $listener) { Write-Output 'Student Center is not running.'; exit }
$centerPid = $listener[0].OwningProcess
$processes = @(Get-CimInstance Win32_Process)
$rootProcess = $processes | Where-Object ProcessId -eq $centerPid
$expectedApp = Join-Path $PSScriptRoot 'app.py'
if (-not $rootProcess.CommandLine.Contains($expectedApp)) { throw 'The listener is not this Student Center. No process stopped.' }
$ids = [System.Collections.Generic.List[int]]::new()
$ids.Add($centerPid)
for ($i=0; $i -lt $ids.Count; $i++) {
    foreach ($child in $processes | Where-Object ParentProcessId -eq $ids[$i]) { $ids.Add($child.ProcessId) }
}
for ($i=$ids.Count-1; $i -ge 0; $i--) { Stop-Process -Id $ids[$i] -ErrorAction SilentlyContinue }
Write-Output 'Student Center stopped.'

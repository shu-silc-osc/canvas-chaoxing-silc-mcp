param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
# Install uv separately with: python -m pip install uv
& $Python -m uv --version
if ($LASTEXITCODE -ne 0) { throw 'uv is required: python -m pip install uv' }
foreach ($project in @('vendor\canvas-mcp', 'legacy\canvas-insearch')) {
    & $Python -m uv sync --project (Join-Path $PSScriptRoot $project) --locked --no-dev --python 3.12
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed: $project" }
}
Write-Output 'Installed. Set CANVAS_API_TOKEN locally, then run .\start.ps1.'

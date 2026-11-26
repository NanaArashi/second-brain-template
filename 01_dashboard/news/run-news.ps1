# Scheduled-task wrapper: load user-level ARK_API_KEY, then run the news fetcher.
$ErrorActionPreference = "Continue"
if (-not $env:ARK_API_KEY) { $env:ARK_API_KEY = [Environment]::GetEnvironmentVariable("ARK_API_KEY", "User") }
$node = "node"
$script = Join-Path $PSScriptRoot "fetch.mjs"
& $node $script
exit $LASTEXITCODE
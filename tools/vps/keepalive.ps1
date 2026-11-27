<#
.SYNOPSIS
  Keeps YeTrade running: starts it if it is not running in this session.

.DESCRIPTION
  Run by the "YeTrade Keep-Alive" scheduled task (see setup-vps.ps1) at
  logon and every 5 minutes. YeTrade itself starts the MT5 bridge and
  reconnects Telegram and MetaTrader 5, so only the app needs watching.
  The app is single-instance, so starting it twice is harmless.

.PARAMETER DryRun
  Report what would happen without starting anything.
#>
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'
$appExe = Join-Path $env:LOCALAPPDATA 'yetrade\app.exe'
$logFile = Join-Path $env:LOCALAPPDATA 'yetrade\keepalive.log'

function Write-Log([string]$message) {
  $line = "{0:yyyy-MM-dd HH:mm:ss}  {1}" -f (Get-Date), $message
  Write-Output $line
  if (-not $DryRun) { Add-Content -Path $logFile -Value $line -ErrorAction SilentlyContinue }
}

if (-not (Test-Path $appExe)) {
  Write-Log "YeTrade is not installed at $appExe - install it first."
  exit 1
}

# Only count YeTrade processes in THIS user session (the app needs a desktop)
$session = (Get-Process -Id $PID).SessionId
$running = Get-Process -Name 'app' -ErrorAction SilentlyContinue |
  Where-Object { $_.SessionId -eq $session -and $_.Path -eq $appExe }

if ($running) {
  if ($DryRun) { Write-Log "YeTrade is running (PID $($running[0].Id)) - nothing to do." }
  exit 0
}

if ($DryRun) {
  Write-Log "YeTrade is NOT running - would start $appExe"
  exit 0
}

Write-Log "YeTrade was not running - starting it."
Start-Process -FilePath $appExe

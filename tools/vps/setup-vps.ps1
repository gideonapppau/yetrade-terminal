<#
.SYNOPSIS
  One-time setup of a Windows VPS for running YeTrade unattended.

.DESCRIPTION
  Run once, as Administrator, while logged in as the Windows user that will
  run YeTrade. It:
    1. stops the VPS from sleeping or hibernating,
    2. stops Windows Update from rebooting while you are signed in
       (updates still install; you reboot when it suits you),
    3. registers the "YeTrade Keep-Alive" scheduled task, which starts
       YeTrade at sign-in and restarts it within 5 minutes if it ever stops.

  It does NOT store any password. For YeTrade to come back after a VPS
  reboot without you signing in, set up automatic sign-in once with
  Microsoft's Autologon tool (see VPS-SETUP.md).

.PARAMETER DryRun
  Show what would be changed without changing anything.
#>
param([switch]$DryRun)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).
  IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $DryRun) {
  Write-Error 'Run this script from an Administrator PowerShell (right-click > Run as administrator).'
}

$keepAlive = Join-Path $PSScriptRoot 'keepalive.ps1'
if (-not (Test-Path $keepAlive)) { Write-Error "keepalive.ps1 not found next to this script ($keepAlive)." }
$user = "$env:USERDOMAIN\$env:USERNAME"

function Step([string]$what, [scriptblock]$action) {
  if ($DryRun) { Write-Output "[dry run] $what"; return }
  Write-Output "-> $what"
  & $action
}

# 1. Never sleep or hibernate
Step 'Disable sleep and hibernation' {
  powercfg /change standby-timeout-ac 0 | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
  powercfg /hibernate off | Out-Null
}

# 2. No automatic reboot while a user is signed in
Step 'Prevent Windows Update from rebooting while signed in' {
  $au = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
  New-Item -Path $au -Force | Out-Null
  Set-ItemProperty -Path $au -Name 'NoAutoRebootWithLoggedOnUsers' -Value 1 -Type DWord
}

# 3. Keep-alive task: at sign-in, then every 5 minutes, in this user's desktop session
Step "Register 'YeTrade Keep-Alive' scheduled task for $user" {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$keepAlive`""
  $atLogon = New-ScheduledTaskTrigger -AtLogOn -User $user
  $every5 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5)
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
  Register-ScheduledTask -TaskName 'YeTrade Keep-Alive' -Action $action `
    -Trigger @($atLogon, $every5) -Principal $principal -Settings $settings -Force | Out-Null
}

Write-Output ''
Write-Output 'Done. Remaining manual steps (see VPS-SETUP.md):'
Write-Output '  - Set up automatic sign-in with Autologon so YeTrade survives reboots.'
Write-Output '  - When leaving Remote Desktop, close the window (Disconnect) - never Sign out.'

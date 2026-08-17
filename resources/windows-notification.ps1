param(
  [string]$Title = "Codex Task Companion",
  [string]$Message = "Task completed",
  [string]$IconPath = "",
  [string]$WorkspacePath = "",
  [string]$ProjectHint = ""
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class CodexTaskCompanionWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
"@

$customBitmap = $null
$customIcon = $null
try {
  if ($IconPath -and (Test-Path -LiteralPath $IconPath)) {
    $customBitmap = New-Object -TypeName System.Drawing.Bitmap -ArgumentList $IconPath
    $customIcon = [System.Drawing.Icon]::FromHandle($customBitmap.GetHicon())
  }
} catch {
  $customBitmap = $null
  $customIcon = $null
}

$icon = New-Object System.Windows.Forms.NotifyIcon
if ($customIcon) {
  $icon.Icon = $customIcon
  $icon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::None
} else {
  $icon.Icon = [System.Drawing.SystemIcons]::Information
  $icon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
}
$icon.Visible = $true
$icon.BalloonTipTitle = $Title
$icon.BalloonTipText = $Message
$closed = $false

$finish = {
  if ($script:closed) { return }
  $script:closed = $true
  try {
    $codeCommand = Get-Command code.cmd -ErrorAction SilentlyContinue
    if (-not $codeCommand) { $codeCommand = Get-Command code -ErrorAction SilentlyContinue }
    if ($WorkspacePath -and (Test-Path -LiteralPath $WorkspacePath) -and $codeCommand) {
      Start-Process -FilePath $codeCommand.Source -ArgumentList @("--reuse-window", $WorkspacePath) | Out-Null
    }

    $processes = @(Get-Process Code -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
    $candidate = $processes | Where-Object { $ProjectHint -and $_.MainWindowTitle -like "*$ProjectHint*" } | Select-Object -First 1
    if (-not $candidate) { $candidate = $processes | Select-Object -First 1 }
    if ($candidate) {
      [CodexTaskCompanionWindow]::ShowWindowAsync($candidate.MainWindowHandle, 9) | Out-Null
      [CodexTaskCompanionWindow]::SetForegroundWindow($candidate.MainWindowHandle) | Out-Null
    }
  } catch {
    # Notification click should never surface a PowerShell error dialog.
  }
  $icon.Visible = $false
  $icon.Dispose()
  if ($customIcon) { $customIcon.Dispose() }
  if ($customBitmap) { $customBitmap.Dispose() }
  [System.Windows.Forms.Application]::ExitThread()
}

$icon.add_BalloonTipClicked($finish)
$icon.add_BalloonTipClosed($finish)
$icon.ShowBalloonTip(7000)
[System.Windows.Forms.Application]::Run()

param(
  [string]$ProjectHint = ""
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NotifyerWindow {
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr handle, int command);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
"@

try {
  $processes = @(Get-Process Code -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })
  $candidate = $processes | Where-Object {
    $ProjectHint -and $_.MainWindowTitle -like "*$ProjectHint*"
  } | Select-Object -First 1
  if (-not $candidate) {
    $candidate = $processes | Select-Object -First 1
  }
  if ($candidate) {
    [NotifyerWindow]::ShowWindowAsync($candidate.MainWindowHandle, 9) | Out-Null
    [NotifyerWindow]::SetForegroundWindow($candidate.MainWindowHandle) | Out-Null
  }
} catch {
  # Focusing the window is best effort and should never show a PowerShell error.
}

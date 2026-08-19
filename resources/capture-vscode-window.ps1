Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NotifyerForegroundWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
}
"@

try {
  $handle = [NotifyerForegroundWindow]::GetForegroundWindow()
  if ($handle -eq [IntPtr]::Zero) { return }

  [uint32]$windowProcessId = 0
  [NotifyerForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$windowProcessId) | Out-Null
  $windowProcess = Get-Process -Id $windowProcessId -ErrorAction Stop
  if ($windowProcess.ProcessName -notmatch '^(Code|code-insiders|Code - Insiders)$') { return }

  [Console]::Out.WriteLine($handle.ToInt64())
} catch {
  # Capturing the originating window is best effort. Workspace/title matching
  # remains available when Windows does not expose a usable foreground handle.
}

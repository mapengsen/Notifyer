param(
  [long]$WindowHandle = 0,
  [string]$ProjectHint = "",
  [string]$WorkspacePath = "",
  [int]$SourceProcessId = 0
)

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public sealed class NotifyerWindowInfo {
  public IntPtr Handle { get; set; }
  public int ProcessId { get; set; }
  public string Title { get; set; }
}
public static class NotifyerWindow {
  private delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr handle);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
  [DllImport("user32.dll")] private static extern int GetWindowTextLength(IntPtr handle);
  [DllImport("user32.dll")] private static extern int GetWindowText(IntPtr handle, StringBuilder text, int length);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr handle, int command);
  [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr handle);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

  public static NotifyerWindowInfo[] GetVisibleWindows() {
    var windows = new List<NotifyerWindowInfo>();
    EnumWindows((handle, parameter) => {
      if (!IsWindowVisible(handle)) return true;
      var length = GetWindowTextLength(handle);
      if (length <= 0) return true;
      var text = new StringBuilder(length + 1);
      GetWindowText(handle, text, text.Capacity);
      uint processId;
      GetWindowThreadProcessId(handle, out processId);
      windows.Add(new NotifyerWindowInfo {
        Handle = handle,
        ProcessId = (int)processId,
        Title = text.ToString(),
      });
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }

  public static bool Activate(IntPtr handle) {
    if (handle == IntPtr.Zero || !IsWindow(handle)) return false;
    if (IsIconic(handle)) ShowWindowAsync(handle, 9);
    else ShowWindowAsync(handle, 5);

    var currentThread = GetCurrentThreadId();
    var foreground = GetForegroundWindow();
    uint foregroundProcessId;
    var foregroundThread = foreground == IntPtr.Zero ? 0u : GetWindowThreadProcessId(foreground, out foregroundProcessId);
    uint targetProcessId;
    var targetThread = GetWindowThreadProcessId(handle, out targetProcessId);
    var attachedForeground = false;
    var attachedTarget = false;
    try {
      if (foregroundThread != 0 && foregroundThread != currentThread) {
        attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
      }
      if (targetThread != 0 && targetThread != currentThread && targetThread != foregroundThread) {
        attachedTarget = AttachThreadInput(currentThread, targetThread, true);
      }
      BringWindowToTop(handle);
      return SetForegroundWindow(handle);
    } finally {
      if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
      if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
    }
  }
}
"@

try {
  function Normalize-Comparable([string]$Value) {
    if (-not $Value) { return "" }
    return $Value.Replace('/', '\').Trim().ToLowerInvariant()
  }

  $processInfo = @()
  try {
    $processInfo = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  } catch {
    $processInfo = @()
  }

  $processInfoById = @{}
  foreach ($info in $processInfo) {
    $processInfoById[[int]$info.ProcessId] = $info
  }

  $windows = @(
    foreach ($window in @([NotifyerWindow]::GetVisibleWindows())) {
      $info = $processInfoById[[int]$window.ProcessId]
      if ($info -and [string]$info.Name -match '^(Code|code-insiders|Code - Insiders)\.exe$') {
        [PSCustomObject]@{
          Id = [int]$window.ProcessId
          Handle = $window.Handle
          Title = [string]$window.Title
          CommandLine = [string]$info.CommandLine
        }
      }
    }
  )

  $candidate = $null

  # A handle captured when this extension instance owned the foreground is the
  # only unambiguous discriminator when several VS Code windows share one main
  # process or use identical folder names.
  if ($WindowHandle -gt 0) {
    $candidate = $windows | Where-Object {
      $_.Handle.ToInt64() -eq $WindowHandle
    } | Select-Object -First 1
  }

  # Process ancestry is only a fallback. Electron may put several workbench
  # windows under one Code process, so it cannot replace the captured handle.
  $sourceCodeProcessId = 0
  if ($SourceProcessId -gt 0 -and $processInfoById.ContainsKey($SourceProcessId)) {
    $currentId = $SourceProcessId
    for ($depth = 0; $depth -lt 12 -and $currentId -gt 0; $depth++) {
      $current = $processInfoById[$currentId]
      if (-not $current) { break }
      if ([string]$current.Name -match '^(Code|code-insiders|Code - Insiders)\.exe$') {
        $sourceCodeProcessId = [int]$current.ProcessId
        break
      }
      $parentId = [int]$current.ParentProcessId
      if ($parentId -eq $currentId) { break }
      $currentId = $parentId
    }
  }

  $sourceWindows = @($windows | Where-Object { $_.Id -eq $sourceCodeProcessId })
  if (-not $candidate -and $sourceCodeProcessId -gt 0 -and $sourceWindows.Count -gt 0 -and $ProjectHint) {
    $candidate = $sourceWindows | Where-Object {
      $_.Title.IndexOf($ProjectHint, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    } | Select-Object -First 1
  }
  if (-not $candidate -and $sourceWindows.Count -eq 1) {
    $candidate = $sourceWindows[0]
  }

  # Fall back to the full workspace path, then the project name in the title.
  if (-not $candidate -and $WorkspacePath) {
    $workspaceComparable = Normalize-Comparable $WorkspacePath
    $candidate = $windows | Where-Object {
      $commandLine = Normalize-Comparable $_.CommandLine
      $commandLine.Contains($workspaceComparable)
    } | Select-Object -First 1
  }
  if (-not $candidate -and $ProjectHint) {
    $candidate = $windows | Where-Object {
      $_.Title.IndexOf($ProjectHint, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
    } | Select-Object -First 1
  }
  if (-not $candidate -and $windows.Count -eq 1) {
    $candidate = $windows[0]
  }
  if ($candidate) {
    [NotifyerWindow]::Activate($candidate.Handle) | Out-Null
  }
} catch {
  # Focusing the window is best effort and should never show a PowerShell error.
}

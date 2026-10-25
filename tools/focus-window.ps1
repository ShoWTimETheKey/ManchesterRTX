# Bring a window to the foreground (test helper: DLSS Frame Generation only runs while its window has focus).
#   tools\focus-window.ps1 [-Title "Manchester RTX"]
param([string]$Title = 'Manchester RTX')
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class FocusNative {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
$proc = Get-Process | Where-Object { $_.MainWindowTitle -eq $Title } | Select-Object -First 1
if ($null -eq $proc) { throw "window '$Title' not found" }
$h = $proc.MainWindowHandle
# share input state with the thread that owns the foreground window, which lets SetForegroundWindow through
$pid0 = 0
$fgThread = [FocusNative]::GetWindowThreadProcessId([FocusNative]::GetForegroundWindow(), [ref]$pid0)
$targetThread = [FocusNative]::GetWindowThreadProcessId($h, [ref]$pid0)
$me = [FocusNative]::GetCurrentThreadId()
[void][FocusNative]::AttachThreadInput($me, $fgThread, $true)
[void][FocusNative]::AttachThreadInput($targetThread, $fgThread, $true)
[void][FocusNative]::ShowWindow($h, 5)
[void][FocusNative]::BringWindowToTop($h)
[void][FocusNative]::SetForegroundWindow($h)
[void][FocusNative]::AttachThreadInput($targetThread, $fgThread, $false)
[void][FocusNative]::AttachThreadInput($me, $fgThread, $false)
Start-Sleep -Milliseconds 300
"foreground: $([FocusNative]::GetForegroundWindow() -eq $h)"

# Get-Process only reports MainWindowTitle for single-process apps. A browser
# keeps its window on a child process, so it shows up with a blank title and
# gets filtered out. Walking the actual top-level windows finds everything.
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class Win {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int size);
}
"@

# Two installs of the same browser ship the same executable name, so the name
# people know an app by has to come from the file itself. One lookup per path,
# because a browser puts nine windows on nine processes out of one binary.
$labels = @{}
function Get-AppLabel($proc) {
  $path = $null
  try { $path = $proc.Path } catch {}
  if (-not $path) { return @($null, $proc.ProcessName) }
  if (-not $labels.ContainsKey($path)) {
    $v = (Get-Item $path).VersionInfo
    $label = $v.FileDescription
    if (-not $label) { $label = $v.ProductName }
    if (-not $label) { $label = $proc.ProcessName }
    $labels[$path] = $label.Trim()
  }
  return @($path, $labels[$path])
}

$found = New-Object System.Collections.ArrayList
$callback = [Win+EnumProc]{
  param($hWnd, $lParam)

  if (-not [Win]::IsWindowVisible($hWnd)) { return $true }
  # a window owned by another window is a dialog or a tool palette
  if ([Win]::GetWindow($hWnd, 4) -ne [IntPtr]::Zero) { return $true }

  $len = [Win]::GetWindowTextLength($hWnd)
  if ($len -eq 0) { return $true }

  $title = New-Object System.Text.StringBuilder ($len + 1)
  [void][Win]::GetWindowText($hWnd, $title, $title.Capacity)
  $class = New-Object System.Text.StringBuilder 256
  [void][Win]::GetClassName($hWnd, $class, 256)

  # UWP leaves ghost windows behind and marks them cloaked, but komorebi cloaks
  # the real windows it hides on other workspaces too. Dropping everything
  # cloaked took those with it, so only the UWP shells go.
  $cloaked = 0
  [void][Win]::DwmGetWindowAttribute($hWnd, 14, [ref]$cloaked, 4)
  if ($cloaked -ne 0 -and $class.ToString() -in @('ApplicationFrameWindow', 'Windows.UI.Core.CoreWindow')) {
    return $true
  }

  # $pid is read-only in PowerShell, so writing to it silently loses every lookup
  $procId = 0
  [void][Win]::GetWindowThreadProcessId($hWnd, [ref]$procId)
  $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
  if (-not $proc) { return $true }

  $cls = $class.ToString()
  if ($cls -eq 'Progman' -or $cls -eq 'WorkerW' -or $cls -like 'komoborder*') { return $true }

  $path, $label = Get-AppLabel $proc
  [void]$found.Add([pscustomobject]@{
    hwnd  = $hWnd.ToInt64()
    exe   = $proc.ProcessName + '.exe'
    name  = $label
    path  = $path
    hidden = ($cloaked -ne 0)
    title = $title.ToString()
    class = $cls
    pid   = $procId
  })
  return $true
}

[void][Win]::EnumWindows($callback, [IntPtr]::Zero)
$found | Sort-Object name, title | ConvertTo-Json -Compress -Depth 3

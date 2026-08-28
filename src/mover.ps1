# Spawning a fresh powershell for every move costs a few hundred milliseconds,
# and dragging a window sends one every frame, so this stays open and reads
# "hwnd x y w h" lines from stdin. One reply line per command, in order.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MoveWin {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
}
"@

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Trim().Split(' ')
  if ($p.Length -ne 5) { [Console]::Out.WriteLine('bad command'); continue }

  $handle = [IntPtr]::new([long]$p[0])
  if (-not [MoveWin]::IsWindow($handle)) { [Console]::Out.WriteLine('gone'); continue }

  # SWP_NOZORDER | SWP_NOACTIVATE, so the window keeps its stacking and focus
  $ok = [MoveWin]::SetWindowPos($handle, [IntPtr]::Zero, [int]$p[1], [int]$p[2], [int]$p[3], [int]$p[4], 0x0004 -bor 0x0010)
  [Console]::Out.WriteLine($(if ($ok) { 'ok' } else { 'failed' }))
}

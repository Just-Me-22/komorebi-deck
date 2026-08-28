# A zip has no installer, so nothing creates a Start Menu entry. This does, and
# points it at the icon so the shortcut does not fall back to a generic one.
#
#   powershell -ExecutionPolicy Bypass -File build\make-shortcut.ps1
#   powershell -ExecutionPolicy Bypass -File build\make-shortcut.ps1 -Desktop
param([switch]$Desktop, [switch]$Remove)

$root = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $root 'dist\win-unpacked\WM Control.exe'
$icon = Join-Path $root 'build\icon.ico'

if (-not (Test-Path $exe)) {
  Write-Output "No build found at $exe"
  Write-Output "Run 'npm run build' first, or unzip a release and edit the path in this script."
  exit 1
}

$targets = @(Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\WM Control.lnk')
if ($Desktop) { $targets += Join-Path ([Environment]::GetFolderPath('Desktop')) 'WM Control.lnk' }

$shell = New-Object -ComObject WScript.Shell
foreach ($path in $targets) {
  if ($Remove) {
    if (Test-Path $path) { Remove-Item $path; Write-Output "removed  $path" }
    continue
  }
  $link = $shell.CreateShortcut($path)
  $link.TargetPath = $exe
  $link.WorkingDirectory = Split-Path $exe -Parent
  $link.IconLocation = "$icon,0"
  $link.Description = 'Editor for komorebi, whkd and YASB'
  $link.Save()
  Write-Output "created  $path"
}

if (-not $Remove) {
  Write-Output ''
  Write-Output 'Windows draws a small arrow badge on every shortcut it makes. That is the'
  Write-Output 'shell marking it as a shortcut, not a missing icon, and it is a system-wide'
  Write-Output 'setting rather than anything this app controls.'
}

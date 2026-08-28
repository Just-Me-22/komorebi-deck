# The Desktop key holds Windows' re-encoded copy, which it overwrites on every
# change. The wallpaper history keeps the file that was actually chosen.
$history = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Wallpapers'
if (Test-Path $history) {
  $path = (Get-ItemProperty $history).BackgroundHistoryPath0
}
if (-not $path) {
  $path = (Get-ItemProperty 'HKCU:\Control Panel\Desktop' -Name WallPaper).WallPaper
}
if ($path -and (Test-Path -LiteralPath $path)) { Write-Output $path }

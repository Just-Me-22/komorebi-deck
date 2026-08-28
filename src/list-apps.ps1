# Rules often need an application that is not running yet, and the Start Menu is
# the one place Windows keeps a list of what is installed under the names people
# actually recognise. Each shortcut is resolved to the executable it launches.
$dirs = @(
  (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs'),
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs')
)

$shell = New-Object -ComObject WScript.Shell
$byPath = @{}

foreach ($dir in $dirs) {
  if (-not (Test-Path $dir)) { continue }
  Get-ChildItem $dir -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.BaseName -like 'Uninstall*') { return }
    try { $target = $shell.CreateShortcut($_.FullName).TargetPath } catch { return }
    if (-not $target -or -not $target.ToLower().EndsWith('.exe')) { return }
    if (-not (Test-Path $target)) { return }
    # Several shortcuts can point at one executable; the shortest name is the
    # plain one rather than a variant like "(X64)" or "(Safe Mode)".
    if (-not $byPath.ContainsKey($target) -or $_.BaseName.Length -lt $byPath[$target].Length) {
      $byPath[$target] = $_.BaseName
    }
  }
}

$byPath.GetEnumerator() | ForEach-Object {
  [pscustomobject]@{
    name = $_.Value
    exe  = Split-Path $_.Key -Leaf
    path = $_.Key
  }
} | Sort-Object name | ConvertTo-Json -Compress -Depth 3

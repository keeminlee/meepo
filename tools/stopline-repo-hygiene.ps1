$violations = @()

$oldOrNotNow = Get-ChildItem -Recurse -File src\tools\old_or_not_now -ErrorAction SilentlyContinue
if ($oldOrNotNow) {
  foreach ($f in $oldOrNotNow) {
    $violations += $f.FullName
  }
}

$oneOffs = Get-ChildItem -Recurse -File tools\_oneoffs -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ne "README.md" }
if ($oneOffs) {
  foreach ($f in $oneOffs) {
    $violations += $f.FullName
  }
}

if ($violations.Count -gt 0) {
  Write-Host "Repo hygiene violations detected:"
  $violations | ForEach-Object { Write-Host "- $_" }
  throw "Legacy or one-off scripts detected. Move to docs/old or remove before merge."
}

Write-Host "PASS: repo hygiene stopline"

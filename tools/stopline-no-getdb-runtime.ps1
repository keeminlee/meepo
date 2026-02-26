$files = Get-ChildItem -Recurse -Filter *.ts src |
  Where-Object {
    $_.FullName -notmatch "\\src\\db\.ts$" -and
    $_.FullName -notmatch "\\src\\tools\\" -and
    $_.FullName -notmatch "\\src\\tests\\"
  }

$usageMatches = $files | Select-String -Pattern '\bgetDb\s*\('
$importMatches = $files | Select-String -Pattern '\bimport\b[^\n]*\bgetDb\b[^\n]*\bfrom\s+[''"].*\/db\.js[''" ]'

if ($usageMatches -and $usageMatches.Count -gt 0) {
  Write-Host "getDb() usage offenders (first 10):"
  $usageMatches | Select-Object -First 10 | ForEach-Object {
    Write-Host "- $($_.Path):$($_.LineNumber) $($_.Line.Trim())"
  }
  throw "getDb() usage found outside src/db.ts or src/tools."
}

if ($importMatches -and $importMatches.Count -gt 0) {
  Write-Host "getDb import offenders (first 10):"
  $importMatches | Select-Object -First 10 | ForEach-Object {
    Write-Host "- $($_.Path):$($_.LineNumber) $($_.Line.Trim())"
  }
  throw "getDb import found outside src/db.ts or src/tools."
}

Write-Host "PASS: no getDb runtime usage/import found outside src/db.ts or src/tools"
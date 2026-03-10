$commandFiles = Get-ChildItem -Recurse -Filter *.ts src\commands

$forbiddenRecapEngineImports = $commandFiles | Select-String -Pattern "recapEngine\.js"

if ($forbiddenRecapEngineImports -and $forbiddenRecapEngineImports.Count -gt 0) {
  Write-Host "Forbidden recapEngine import detected in command/lifecycle surfaces (first 10):"
  $forbiddenRecapEngineImports | Select-Object -First 10 | ForEach-Object {
    Write-Host "- $($_.Path):$($_.LineNumber) $($_.Line.Trim())"
  }
  throw "Command/lifecycle recap generation must use recapService boundary, not recapEngine imports."
}

$forbiddenDirectGenerationCalls = $commandFiles | Select-String -Pattern "\bgenerateSessionRecap\s*\(|\bregenerateSessionRecap\s*\("

if ($forbiddenDirectGenerationCalls -and $forbiddenDirectGenerationCalls.Count -gt 0) {
  Write-Host "Forbidden direct recap generation calls detected in command/lifecycle surfaces (first 10):"
  $forbiddenDirectGenerationCalls | Select-Object -First 10 | ForEach-Object {
    Write-Host "- $($_.Path):$($_.LineNumber) $($_.Line.Trim())"
  }
  throw "Command/lifecycle recap generation must call recapService contract methods."
}

Write-Host "PASS: recap service boundary enforced for command/lifecycle surfaces"

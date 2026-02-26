Get-ChildItem -Recurse -Filter *.ts src |
  Select-String "process\.env" |
  Where-Object { $_.Path -notmatch "\\src\\config\\" -and $_.Path -notmatch "\\src\\tests\\" } |
  ForEach-Object { throw "process.env found outside src/config: $($_.Path)" }

Write-Host "PASS: no process.env usage found outside src/config"
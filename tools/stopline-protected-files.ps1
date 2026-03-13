param(
  [ValidateSet("staged", "working", "head")]
  [string]$Mode = "staged"
)

$breakglass = $env:MEEPO_BREAKGLASS
if ($breakglass -eq "I_UNDERSTAND_PROD_RISK") {
  Write-Host "WARN: protected-file stopline bypassed via MEEPO_BREAKGLASS"
  exit 0
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

$patternsFile = Join-Path $PSScriptRoot "protected-paths.txt"
if (-not (Test-Path $patternsFile)) {
  throw "Missing protected paths file: $patternsFile"
}

$patterns = Get-Content $patternsFile |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ -and -not $_.StartsWith("#") }

if ($patterns.Count -eq 0) {
  Write-Host "PASS: no protected patterns configured"
  exit 0
}

$changedFiles = @()
if ($Mode -eq "staged") {
  $changedFiles = git diff --cached --name-only --diff-filter=ACMR
} elseif ($Mode -eq "working") {
  $changedFiles = git diff --name-only --diff-filter=ACMR
} else {
  $changedFiles = git diff-tree --no-commit-id --name-only -r HEAD
}

$changedFiles = $changedFiles |
  ForEach-Object { $_.Trim() } |
  Where-Object { $_ }

if ($changedFiles.Count -eq 0) {
  Write-Host "PASS: no changed files for mode '$Mode'"
  exit 0
}

$violations = New-Object System.Collections.Generic.List[string]
foreach ($file in $changedFiles) {
  foreach ($pattern in $patterns) {
    $matcher = New-Object System.Management.Automation.WildcardPattern($pattern, [System.Management.Automation.WildcardOptions]::IgnoreCase)
    if ($matcher.IsMatch($file)) {
      $violations.Add("$file (matched $pattern)")
      break
    }
  }
}

if ($violations.Count -gt 0) {
  Write-Host "STOPLINE: protected file edits detected:"
  $violations | Sort-Object -Unique | ForEach-Object { Write-Host "- $_" }
  Write-Host ""
  Write-Host "If this is a production break-glass change, rerun with:"
  Write-Host "MEEPO_BREAKGLASS=I_UNDERSTAND_PROD_RISK"
  throw "Protected-file stopline failed."
}

Write-Host "PASS: no protected file edits detected"

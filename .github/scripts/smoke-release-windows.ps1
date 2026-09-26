param(
  [Parameter(Mandatory = $true)][string]$Artifacts,
  [string]$PreviousArtifacts = ""
)

$ErrorActionPreference = "Stop"
if ($env:CI -ne "true") { throw "release installation smoke is restricted to an isolated CI runner" }

$smokeRoot = Join-Path $env:RUNNER_TEMP "local-expert-disk-release-smoke"
$installRoot = Join-Path $smokeRoot "install"
$env:APPDATA = Join-Path $smokeRoot "AppData\Roaming"
$database = Join-Path $env:APPDATA "local.expertdisk.desktop\index.db"
$installer = Get-ChildItem -Path $Artifacts -Filter "*.exe" | Select-Object -First 1
if (-not $installer) { throw "NSIS installer was not found" }
$firstInstaller = $installer
if ($PreviousArtifacts -and (Test-Path $PreviousArtifacts)) {
  $firstInstaller = Get-ChildItem -Path $PreviousArtifacts -Filter "*.exe" | Select-Object -First 1
  if (-not $firstInstaller) { throw "previous NSIS installer was not found" }
}
New-Item -ItemType Directory -Force -Path $installRoot | Out-Null

function Install-Release {
  param([Parameter(Mandatory = $true)][string]$InstallerPath)
  $process = Start-Process -FilePath $InstallerPath -ArgumentList @("/S", "/D=$installRoot") -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "installer failed with exit code $($process.ExitCode)" }
}

function Start-AndWaitForDatabase {
  $application = Get-ChildItem -Path $installRoot -Filter "*.exe" -Recurse |
    Where-Object { $_.Name -notmatch "uninstall" } |
    Select-Object -First 1
  if (-not $application) { throw "installed application was not found" }
  $process = Start-Process -FilePath $application.FullName -PassThru
  try {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      if (Test-Path $database) {
        & cargo run -p release-smoke --locked -- probe $database *> $null
        if ($LASTEXITCODE -eq 0) { return }
      }
      if ($process.HasExited) { throw "installed application exited before creating SQLite" }
      Start-Sleep -Seconds 1
    }
    throw "installed application did not create SQLite"
  } finally {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  }
}

Install-Release -InstallerPath $firstInstaller.FullName
Start-AndWaitForDatabase
cargo run -p release-smoke --locked -- mark $database
Install-Release -InstallerPath $installer.FullName
Start-AndWaitForDatabase
cargo run -p release-smoke --locked -- verify $database

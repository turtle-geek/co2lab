# CO2LAB worker installer for Windows. The hub serves this file with its own URL filled in.
#   irm __HUB_URL__/install.ps1 | iex
# 1. Finds Node 22+ (or downloads portable Node 24 LTS into %LOCALAPPDATA%\co2lab\node; no admin needed).
# 2. Downloads the prebuilt worker from the hub into %LOCALAPPDATA%\co2lab\worker (no git, no npm install).
# 3. Optionally starts the worker when you log in (a shortcut in your Startup folder).
# 4. Starts the worker. The first time, it shows a code: approve this computer in the dashboard.
# Settings (optional): $env:CO2LAB_AUTOSTART = '1' or '0' skips the question.

& {
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest is much faster without the progress bar
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Hub = '__HUB_URL__'
$Root = Join-Path $env:LOCALAPPDATA 'co2lab'
$App = Join-Path $Root 'worker'
$NodeDir = Join-Path $Root 'node'
# Windows' own bsdtar; Git for Windows puts a GNU tar on PATH that cannot read C:\ paths.
$Tar = Join-Path $env:SystemRoot 'System32\tar.exe'

function Say($msg) { Write-Host "co2lab: $msg" -ForegroundColor Green }

function NodeMajor($exe) {
  try { return [int](& $exe -p "process.versions.node.split('.')[0]" 2>$null) } catch { return 0 }
}

function Find-Node {
  $local = Join-Path $NodeDir 'node.exe'
  if ((Test-Path $local) -and (NodeMajor $local) -ge 22) { return $local }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and (NodeMajor $cmd.Source) -ge 22) { return $cmd.Source }
  return $null
}

function Install-Node {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $release = (Invoke-RestMethod 'https://nodejs.org/dist/index.json') | Where-Object { $_.lts -and $_.version -like 'v24.*' } | Select-Object -First 1
  if (-not $release) { throw 'Could not find a Node 24 LTS release on nodejs.org' }
  $v = $release.version
  $name = "node-$v-win-$arch"
  Say "Downloading Node $v ($arch) from nodejs.org ..."
  $tmp = Join-Path $env:TEMP "co2lab-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory -Force $tmp | Out-Null
  try {
    $zip = Join-Path $tmp "$name.zip"
    Invoke-WebRequest "https://nodejs.org/dist/$v/$name.zip" -OutFile $zip -UseBasicParsing
    $sums = (Invoke-WebRequest "https://nodejs.org/dist/$v/SHASUMS256.txt" -UseBasicParsing).Content
    $want = ($sums -split "`n" | Where-Object { $_ -match "\s$name\.zip$" }) -replace '\s.*$', ''
    $got = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if (-not $want -or $got -ne $want.Trim().ToLower()) { throw "Node download checksum mismatch ($got)" }
    & $Tar -xf $zip -C $tmp
    if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
    New-Item -ItemType Directory -Force $Root | Out-Null
    Move-Item (Join-Path $tmp $name) $NodeDir
  } finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  }
  return (Join-Path $NodeDir 'node.exe')
}

if (-not (Test-Path $Tar)) { throw "tar.exe was not found in $env:SystemRoot\System32 (needs Windows 10 1803 or newer)" }

$Node = Find-Node
if (-not $Node) { $Node = Install-Node }
Say "Using Node $(& $Node --version) at $Node"

# ---------- Worker bundle ----------
Say "Downloading the worker from $Hub ..."
New-Item -ItemType Directory -Force $App | Out-Null
$tgz = Join-Path $env:TEMP "co2lab-worker-$([guid]::NewGuid().ToString('N')).tgz"
try {
  Invoke-WebRequest "$Hub/install/worker.tgz" -OutFile $tgz -UseBasicParsing
  # Replace the code but keep .device.json (this computer's token) so re-running updates in place.
  foreach ($old in 'worker.mjs', 'node_modules', 'package.json') {
    $p = Join-Path $App $old
    if (Test-Path $p) { Remove-Item -Recurse -Force $p }
  }
  & $Tar -xzf $tgz -C $App
  if ($LASTEXITCODE -ne 0) { throw "Could not unpack the worker (tar exit $LASTEXITCODE)" }
} finally {
  Remove-Item -Force $tgz -ErrorAction SilentlyContinue
}

# Restarts the worker if it stops; exit code 3 means the hub rejected this device, so stop then.
$startCmd = Join-Path $App 'start-worker.cmd'
@"
@echo off
title CO2LAB worker
cd /d "%~dp0"
:loop
"$Node" worker.mjs --hub $Hub
if %ERRORLEVEL%==3 goto :eof
timeout /t 5 /nobreak >nul
goto loop
"@ | Set-Content -Encoding ASCII $startCmd

# ---------- Start at login (optional) ----------
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'CO2LAB worker.cmd'
$auto = $env:CO2LAB_AUTOSTART
if (-not $auto) {
  $ans = Read-Host 'Start the CO2LAB worker automatically when you log in? [Y/n]'
  $auto = if ($ans -match '^\s*n') { '0' } else { '1' }
}
if ($auto -eq '1') {
  "@start `"CO2LAB worker`" /min `"$startCmd`"" | Set-Content -Encoding ASCII $startup
  Say "It will start when you log in (remove '$startup' to stop that)."
} elseif (Test-Path $startup) {
  Remove-Item -Force $startup
}

# ---------- Pair (first time) and run ----------
Say "Starting the worker. Press Ctrl+C to stop it; run $startCmd to start it again."
Push-Location $App
try { & $Node worker.mjs --hub $Hub } finally { Pop-Location }
}

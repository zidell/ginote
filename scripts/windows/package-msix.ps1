# Tauri로 만든 ginote.exe를 MSIX로 묶는다(docs/DESKTOP.md의 Windows).
# 사용: pwsh scripts/windows/package-msix.ps1 -Version 0.1.90 -IdentityName ... -Publisher "CN=..." `
#         -PublisherDisplayName ... -Output Ginote.msix
param(
  [Parameter(Mandatory)] [string] $Version,
  [Parameter(Mandatory)] [string] $IdentityName,
  [Parameter(Mandatory)] [string] $Publisher,
  [Parameter(Mandatory)] [string] $PublisherDisplayName,
  [Parameter(Mandatory)] [string] $Output,
  [string] $Executable = 'src-tauri/target/release/ginote.exe'
)
$ErrorActionPreference = 'Stop'

# MSIX 버전은 네 자리이고 마지막 자리는 Store가 쓰므로 0이다.
$parts = $Version.Split('.')
if ($parts.Count -ne 3) { throw "Version must look like 0.1.90, got $Version" }
$msixVersion = "$Version.0"

$layout = Join-Path ([IO.Path]::GetTempPath()) "ginote-msix-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path (Join-Path $layout 'Assets') | Out-Null
Copy-Item $Executable (Join-Path $layout 'ginote.exe')
Copy-Item 'src-tauri/resources/readme.txt' $layout
foreach ($logo in 'StoreLogo', 'Square44x44Logo', 'Square71x71Logo', 'Square150x150Logo', 'Square310x310Logo') {
  Copy-Item "src-tauri/icons/$logo.png" (Join-Path $layout "Assets/$logo.png")
}

$escape = { param($value) [Security.SecurityElement]::Escape($value) }
$manifest = Get-Content 'src-tauri/windows/AppxManifest.xml' -Raw
$manifest = $manifest.Replace('{{IDENTITY_NAME}}', (& $escape $IdentityName)).
  Replace('{{PUBLISHER}}', (& $escape $Publisher)).
  Replace('{{PUBLISHER_DISPLAY_NAME}}', (& $escape $PublisherDisplayName)).
  Replace('{{VERSION}}', $msixVersion)
if ($manifest -match '\{\{[A-Z_]+\}\}') { throw 'AppxManifest.xml still has an unfilled placeholder.' }
Set-Content -Path (Join-Path $layout 'AppxManifest.xml') -Value $manifest -Encoding utf8

$kits = 'C:\Program Files (x86)\Windows Kits\10\bin'
$makeappx = Get-ChildItem $kits -Recurse -Filter makeappx.exe |
  Where-Object { $_.FullName -match '\\x64\\' } |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw 'makeappx.exe was not found in the Windows SDK.' }

& $makeappx.FullName pack /o /d $layout /p $Output
if ($LASTEXITCODE -ne 0) { throw "makeappx failed with $LASTEXITCODE" }
Remove-Item $layout -Recurse -Force
Write-Host "Packaged $Output ($msixVersion)"

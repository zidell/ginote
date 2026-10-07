# Standalone Windows PowerShell 5.1 tests; no Pester or network required.
$ErrorActionPreference = 'Stop'
$fixtureDir = Join-Path ([IO.Path]::GetTempPath()) ('ginote-installer-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $fixtureDir | Out-Null
$archiveName = 'ginote-tui_windows-amd64.zip'
$global:GinoteInstallerTestArchive = Join-Path $fixtureDir $archiveName
$payloadDir = Join-Path $fixtureDir 'payload'
$destination = Join-Path $fixtureDir 'install with spaces'
$global:GinoteInstallerTestScenario = 'success'
$originalPath = $env:Path

function Assert-True($Condition, $Message) {
    if (!$Condition) { throw "FAIL: $Message" }
}

function Invoke-RestMethod {
    param($Uri, $Headers)
    if ($global:GinoteInstallerTestScenario -eq 'no-release') { return @() }
    # A desktop release must not be mistaken for the TUI prerelease.
    @(
        [pscustomobject]@{ draft = $false; tag_name = 'v0.1.999'; published_at = '2026-10-08'; assets = @() },
        [pscustomobject]@{ draft = $false; tag_name = 'tui-v0.1.99'; published_at = '2026-10-07'; assets = @(
            [pscustomobject]@{ name = $archiveName; browser_download_url = 'https://fixture/archive' },
            [pscustomobject]@{ name = "$archiveName.sha256"; browser_download_url = 'https://fixture/hash' }
        ) }
    )
}

function Invoke-WebRequest {
    param([switch]$UseBasicParsing, $Uri, $OutFile, $Headers)
    if ($Uri -eq 'https://fixture/archive') {
        Copy-Item -LiteralPath $global:GinoteInstallerTestArchive -Destination $OutFile
    } elseif ($Uri -eq 'https://fixture/hash') {
        $hash = (Get-FileHash -LiteralPath $global:GinoteInstallerTestArchive -Algorithm SHA256).Hash
        if ($global:GinoteInstallerTestScenario -eq 'bad-hash') { $hash = '0' * 64 }
        [IO.File]::WriteAllText($OutFile, "$hash  $archiveName`n")
    } else { throw "Unexpected download: $Uri" }
}

try {
    New-Item -ItemType Directory -Path $payloadDir | Out-Null
    $binary = Join-Path $payloadDir 'ginote-tui.exe'
    [IO.File]::WriteAllText($binary, 'first binary')
    Compress-Archive -LiteralPath $binary -DestinationPath $global:GinoteInstallerTestArchive
    & "$PSScriptRoot/install.ps1" -InstallDir $destination -NoPathUpdate
    $installed = Join-Path $destination 'ginote-tui.exe'
    Assert-True ([IO.File]::ReadAllText($installed) -eq 'first binary') 'fresh install'

    [IO.File]::WriteAllText($binary, 'updated binary')
    Remove-Item -LiteralPath $global:GinoteInstallerTestArchive
    Compress-Archive -LiteralPath $binary -DestinationPath $global:GinoteInstallerTestArchive
    & "$PSScriptRoot/install.ps1" -InstallDir $destination -NoPathUpdate
    Assert-True ([IO.File]::ReadAllText($installed) -eq 'updated binary') 'replace existing binary'

    $locked = [IO.File]::Open($installed, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $failed = $false
        try { & "$PSScriptRoot/install.ps1" -InstallDir $destination -NoPathUpdate } catch { $failed = $true }
        Assert-True $failed 'locked executable must fail'
        Assert-True ([IO.File]::ReadAllText($installed) -eq 'updated binary') 'locked executable keeps installed binary'
    } finally { $locked.Dispose() }

    foreach ($failure in @('bad-hash', 'no-release', 'missing-binary')) {
        $global:GinoteInstallerTestScenario = $failure
        if ($failure -eq 'missing-binary') {
            $other = Join-Path $payloadDir 'other.txt'
            [IO.File]::WriteAllText($other, 'invalid archive')
            Remove-Item -LiteralPath $global:GinoteInstallerTestArchive
            Compress-Archive -LiteralPath $other -DestinationPath $global:GinoteInstallerTestArchive
        }
        $failed = $false
        try { & "$PSScriptRoot/install.ps1" -InstallDir $destination -NoPathUpdate } catch { $failed = $true }
        Assert-True $failed "$failure must fail"
        Assert-True ([IO.File]::ReadAllText($installed) -eq 'updated binary') "$failure keeps installed binary"
    }
    Assert-True ($env:Path -eq $originalPath) 'NoPathUpdate preserves PATH'
    Assert-True (@(Get-ChildItem -LiteralPath $destination -Force).Count -eq 1) 'no staged files left'
    Write-Host 'PASS: fresh install, update, locked executable, checksum rejection, missing release, missing binary, cleanup.'
} finally {
    Remove-Variable GinoteInstallerTestArchive,GinoteInstallerTestScenario -Scope Global -ErrorAction SilentlyContinue
    $resolved = [IO.Path]::GetFullPath($fixtureDir)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved) -like 'ginote-installer-test-*') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

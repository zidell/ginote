# Native Windows install: no Go, C compiler, Bash, or administrator access needed.
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\ginote-tui'),
    [switch]$NoPathUpdate
)

& {
    $ErrorActionPreference = 'Stop'
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or [IntPtr]::Size -ne 8) {
        throw 'Ginote TUI requires 64-bit Windows and 64-bit PowerShell.'
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $archiveName = 'ginote-tui_windows-amd64.zip'
    $headers = @{ 'User-Agent' = 'Ginote-TUI-Installer'; Accept = 'application/vnd.github+json' }
    $release = $null
    # TUI releases are prereleases, so releases/latest refers to the desktop app.
    for ($page = 1; $page -le 10; $page++) {
        $releases = @(Invoke-RestMethod -Uri "https://api.github.com/repos/zidell/ginote/releases?per_page=100&page=$page" -Headers $headers)
        $release = $releases | Where-Object {
            !$_.draft -and $_.tag_name -like 'tui-v*' -and
            ($_.assets.name -contains $archiveName) -and
            ($_.assets.name -contains "$archiveName.sha256")
        } | Sort-Object published_at -Descending | Select-Object -First 1
        if ($release -or $releases.Count -lt 100) { break }
    }
    if (!$release) { throw 'No Windows TUI release is published yet. See github.com/zidell/ginote/releases.' }
    $archiveAsset = $release.assets | Where-Object name -eq $archiveName | Select-Object -First 1
    $hashAsset = $release.assets | Where-Object name -eq "$archiveName.sha256" | Select-Object -First 1
    $temporary = Join-Path ([IO.Path]::GetTempPath()) ('ginote-tui-install-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $temporary | Out-Null
    try {
        Write-Host "Downloading Ginote TUI $($release.tag_name)..."
        $archive = Join-Path $temporary $archiveName
        $hashFile = Join-Path $temporary "$archiveName.sha256"
        Invoke-WebRequest -UseBasicParsing -Uri $archiveAsset.browser_download_url -OutFile $archive -Headers $headers
        Invoke-WebRequest -UseBasicParsing -Uri $hashAsset.browser_download_url -OutFile $hashFile -Headers $headers
        $expected = ([IO.File]::ReadAllText($hashFile).Trim() -split '\s+')[0]
        if ($expected -notmatch '^[a-fA-F0-9]{64}$' -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expected) {
            throw 'Download checksum mismatch; the installed binary was kept.'
        }
        $expanded = Join-Path $temporary 'expanded'
        Expand-Archive -LiteralPath $archive -DestinationPath $expanded
        $binary = Join-Path $expanded 'ginote-tui.exe'
        if (!(Test-Path -LiteralPath $binary -PathType Leaf)) { throw 'The release archive does not contain ginote-tui.exe.' }
        New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
        $target = Join-Path $InstallDir 'ginote-tui.exe'
        $staged = Join-Path $InstallDir ('.ginote-tui-' + [guid]::NewGuid() + '.exe')
        $backup = $staged + '.old'
        try {
            Copy-Item -LiteralPath $binary -Destination $staged
            if (Test-Path -LiteralPath $target) {
                [IO.File]::Replace($staged, $target, $backup)
            } else {
                [IO.File]::Move($staged, $target)
            }
        } catch {
            throw "Could not install Ginote TUI. Close any running ginote-tui process and retry. $($_.Exception.Message)"
        } finally {
            if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Force }
            if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
        }
        if (!$NoPathUpdate) {
            $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
            if (($userPath -split ';').TrimEnd('\') -notcontains $InstallDir.TrimEnd('\')) {
                [Environment]::SetEnvironmentVariable('Path', "$InstallDir;$userPath", 'User')
            }
            if (($env:Path -split ';').TrimEnd('\') -notcontains $InstallDir.TrimEnd('\')) {
                $env:Path = "$InstallDir;$env:Path"
            }
        }
        Write-Host "Installed: $target"
        Write-Host 'Run ginote-tui to start. Run this installer again to update.'
    } finally {
        # This directory is created above under GetTempPath; never delete InstallDir.
        $resolved = [IO.Path]::GetFullPath($temporary)
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
            [IO.Path]::GetFileName($resolved) -like 'ginote-tui-install-*') {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}

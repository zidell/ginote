# Build the native Windows TUI, including microphone support.
# Requires Go (go.mod) and a MinGW-compatible C compiler on PATH.
[CmdletBinding()]
param([string]$BinDir = (Join-Path $env:LOCALAPPDATA 'Programs\ginote-tui'))

& {
    $ErrorActionPreference = 'Stop'
    foreach ($tool in @('go', 'gcc')) {
        if (!(Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "Local builds require $tool on PATH. Use install.ps1 to install a prebuilt binary."
        }
    }
    $pepper = $env:VITE_NOTE_LOCK_PEPPER
    $envFile = Join-Path $PSScriptRoot '..\.env'
    if (!$pepper -and (Test-Path -LiteralPath $envFile)) {
        foreach ($line in [IO.File]::ReadAllLines($envFile)) {
            if ($line -match '^VITE_NOTE_LOCK_PEPPER=(.*)$') {
                $pepper = $Matches[1] -replace '["''\s]', ''
            }
        }
    }
    $flags = @()
    if ($pepper) { $flags = @('-ldflags', "-X github.com/zidell/ginote/tui/internal/notes.AppPepper=$pepper") }
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    $target = Join-Path $BinDir 'ginote-tui.exe'
    $temporary = Join-Path $BinDir ('.ginote-tui-' + [guid]::NewGuid() + '.exe')
    $backup = $temporary + '.old'
    $previousCGO = $env:CGO_ENABLED
    Push-Location $PSScriptRoot
    try {
        $env:CGO_ENABLED = '1'
        & go build @flags -o $temporary ./cmd/ginote-tui
        if ($LASTEXITCODE -ne 0) { throw 'Ginote TUI build failed; the installed binary was kept.' }
        if (Test-Path -LiteralPath $target) {
            [IO.File]::Replace($temporary, $target, $backup)
        } else {
            [IO.File]::Move($temporary, $target)
        }
        Write-Host "Installed: $target"
    } finally {
        $env:CGO_ENABLED = $previousCGO
        Pop-Location
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    }
}

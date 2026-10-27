$ErrorActionPreference = 'Stop'

$desktopDir = [System.IO.Path]::GetFullPath($PSScriptRoot)
$tempParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$tempRoot = [System.IO.Path]::GetFullPath((Join-Path $tempParent "coderax-desktop-$([guid]::NewGuid().ToString('N'))"))
$tempPrefix = $tempParent.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $tempRoot.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'The temporary build directory is outside the system temp folder.'
}

$appDir = Join-Path $tempRoot 'app'
$originalLocation = Get-Location
$buildSucceeded = $false

try {
    New-Item -ItemType Directory -Force -Path $appDir | Out-Null
    Get-ChildItem -LiteralPath $desktopDir -Force |
        Where-Object { $_.Name -notin @('node_modules', 'release') } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $appDir -Recurse -Force }

    Set-Location $appDir
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Could not install the locked desktop dependencies.' }

    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'The desktop source check failed.' }

    & npm.cmd run desktop:test
    if ($LASTEXITCODE -ne 0) { throw 'The desktop URL tests failed.' }

    & .\node_modules\.bin\electron-builder.cmd --win nsis --x64 --publish never
    if ($LASTEXITCODE -ne 0) { throw 'Electron Builder could not create the Windows installer.' }

    $installer = Get-Item 'release\Coderax-Windows-x64.exe' -ErrorAction SilentlyContinue
    if (-not $installer -or $installer.Length -lt 10MB) {
        throw 'The Windows installer is missing or unexpectedly small.'
    }

    $releaseDir = Join-Path $desktopDir 'release'
    New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
    Copy-Item -LiteralPath $installer.FullName -Destination (Join-Path $releaseDir $installer.Name) -Force
    $buildSucceeded = $true
} finally {
    Set-Location $originalLocation
    if (Test-Path -LiteralPath $tempRoot) {
        $resolvedTempRoot = [System.IO.Path]::GetFullPath($tempRoot)
        if (-not $resolvedTempRoot.StartsWith($tempPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing to remove a build directory outside the system temp folder.'
        }
        Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force
    }
}

if ($buildSucceeded) {
    Write-Host "Created $([System.IO.Path]::GetFullPath((Join-Path $desktopDir 'release\Coderax-Windows-x64.exe')))"
}

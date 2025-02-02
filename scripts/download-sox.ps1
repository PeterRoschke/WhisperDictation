$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootPath = Join-Path -Path $PSScriptRoot -ChildPath ".." -Resolve
$resourcesPath = Join-Path -Path $rootPath -ChildPath "resources"
$binPath = Join-Path -Path $resourcesPath -ChildPath "bin"
$win32Path = Join-Path -Path $binPath -ChildPath "win32"

Write-Host "Creating directories..."
if (-not (Test-Path -Path $resourcesPath)) {
    New-Item -Path $resourcesPath -ItemType Directory -Force | Out-Null
    Write-Host "Created resources directory"
}

if (-not (Test-Path -Path $binPath)) {
    New-Item -Path $binPath -ItemType Directory -Force | Out-Null
    Write-Host "Created bin directory"
}

if (-not (Test-Path -Path $win32Path)) {
    New-Item -Path $win32Path -ItemType Directory -Force | Out-Null
    Write-Host "Created win32 directory"
}

$soxVersion = "14.4.2"
$soxZip = Join-Path -Path $win32Path -ChildPath "sox.zip"
$soxDir = Join-Path -Path $win32Path -ChildPath "sox"
$soxUrl = "https://downloads.sourceforge.net/project/sox/sox/$soxVersion/sox-$soxVersion-win32.zip"

Write-Host "Downloading SoX..."
try {
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($soxUrl, $soxZip)
    
    if (-not (Test-Path -Path $soxZip)) {
        throw "Downloaded file not found"
    }
    
    $fileInfo = Get-Item $soxZip
    if ($fileInfo.Length -eq 0) {
        throw "Downloaded file is empty"
    }
    
    Write-Host "Download completed successfully. File size: $($fileInfo.Length) bytes"
} catch {
    Write-Error "Failed to download SoX: $_"
    if (Test-Path -Path $soxZip) {
        Remove-Item -Path $soxZip -Force
    }
    exit 1
}

Write-Host "Extracting SoX..."
try {
    if (Test-Path -Path $soxDir) {
        Remove-Item -Path $soxDir -Recurse -Force
    }
    
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($soxZip, $soxDir)
} catch {
    Write-Error "Failed to extract SoX: $_"
    if (Test-Path -Path $soxDir) {
        Remove-Item -Path $soxDir -Recurse -Force
    }
    exit 1
}

Write-Host "Setting up SoX..."
try {
    $soxBinDir = Join-Path -Path $soxDir -ChildPath "sox-$soxVersion"
    if (-not (Test-Path -Path $soxBinDir)) {
        throw "SoX binary directory not found at: $soxBinDir"
    }
    
    $soxExe = Join-Path -Path $soxBinDir -ChildPath "sox.exe"
    if (-not (Test-Path -Path $soxExe)) {
        throw "sox.exe not found at: $soxExe"
    }
    
    # Move all necessary files to win32 directory
    Move-Item -Path $soxExe -Destination $win32Path -Force
    Get-ChildItem -Path $soxBinDir -Filter "*.dll" | ForEach-Object {
        Move-Item -Path $_.FullName -Destination $win32Path -Force
    }
} catch {
    Write-Error "Failed to set up SoX: $_"
    exit 1
}

Write-Host "Cleaning up..."
try {
    if (Test-Path -Path $soxZip) {
        Remove-Item -Path $soxZip -Force
    }
    if (Test-Path -Path $soxDir) {
        Remove-Item -Path $soxDir -Recurse -Force
    }
} catch {
    Write-Error "Failed to clean up: $_"
    # Don't exit here as the main task is done
}

Write-Host "SoX setup complete" 
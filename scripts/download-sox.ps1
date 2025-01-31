$PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$resourcesDir = Join-Path -Path $PSScriptRoot -ChildPath ".." -Resolve
$resourcesDir = Join-Path -Path $resourcesDir -ChildPath "resources"
$binDir = Join-Path -Path $resourcesDir -ChildPath "bin"
$win32Dir = Join-Path -Path $binDir -ChildPath "win32"

Write-Host "Creating directories..."
if (-not (Test-Path -Path $resourcesDir)) {
    New-Item -Path $resourcesDir -ItemType Directory | Out-Null
    Write-Host "Created resources directory"
}

if (-not (Test-Path -Path $binDir)) {
    New-Item -Path $binDir -ItemType Directory | Out-Null
    Write-Host "Created bin directory"
}

if (-not (Test-Path -Path $win32Dir)) {
    New-Item -Path $win32Dir -ItemType Directory | Out-Null
    Write-Host "Created win32 directory"
}

$soxVersion = "14.4.2"
$soxZip = Join-Path -Path $win32Dir -ChildPath "sox.zip"
$soxDir = Join-Path -Path $win32Dir -ChildPath "sox"
# Using a direct download URL from a mirror
$soxUrl = "https://downloads.sourceforge.net/project/sox/sox/14.4.2/sox-14.4.2-win32.zip"

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
    
    Move-Item -Path $soxExe -Destination $win32Dir -Force
    Move-Item -Path (Join-Path -Path $soxBinDir -ChildPath "*.dll") -Destination $win32Dir -Force
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
# Download and setup FFmpeg binaries for all platforms
$ErrorActionPreference = "Stop"

# Configuration
$ffmpegBuilds = @{
    win32 = @{
        url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n6.1-latest-win64-gpl-6.1.zip"
        exeName = "ffmpeg.exe"
        archiveType = "zip"
    }
    darwin = @{
        url = "https://evermeet.cx/ffmpeg/ffmpeg-6.1.zip"
        exeName = "ffmpeg"
        archiveType = "zip"
    }
    linux = @{
        url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n6.1-latest-linux64-gpl-6.1.tar.xz"
        exeName = "ffmpeg"
        archiveType = "tar.xz"
    }
}

# Setup directories
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$binDir = Join-Path $rootDir "resources\bin"
$cacheDir = Join-Path $env:LOCALAPPDATA "WhisperDictation\cache"

# Create cache directory
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

# Function to download file if not in cache
function Download-File {
    param (
        [string]$url,
        [string]$output
    )
    if (-not (Test-Path $output)) {
        Write-Host "Downloading from $url..."
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($url, $output)
    } else {
        Write-Host "Using cached file: $output"
    }
}

# Function to extract archives
function Extract-Archive {
    param (
        [string]$archivePath,
        [string]$destinationPath,
        [string]$archiveType
    )
    
    $extractDir = Join-Path $env:TEMP "ffmpeg-temp"
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    
    switch ($archiveType) {
        "zip" {
            Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force
        }
        "tar.xz" {
            # For Linux builds, we'll extract during the Linux build process
            # This is just a placeholder as we can't extract tar.xz in PowerShell easily
            Copy-Item $archivePath -Destination $extractDir
        }
    }
    
    return $extractDir
}

# Process each platform
foreach ($platform in $ffmpegBuilds.Keys) {
    Write-Host "`nProcessing FFmpeg for $platform..."
    
    $build = $ffmpegBuilds[$platform]
    $platformDir = Join-Path $binDir $platform
    $cachedFile = Join-Path $cacheDir "ffmpeg-$platform.$($build.archiveType)"
    $destPath = Join-Path $platformDir $build.exeName
    
    # Create platform directory
    New-Item -ItemType Directory -Force -Path $platformDir | Out-Null
    
    # Skip if FFmpeg already exists
    if (Test-Path $destPath) {
        Write-Host "FFmpeg for $platform already exists, skipping..."
        continue
    }
    
    # Download FFmpeg
    Download-File -url $build.url -output $cachedFile
    
    # Extract and copy FFmpeg
    Write-Host "Extracting FFmpeg for $platform..."
    $extractDir = Extract-Archive -archivePath $cachedFile -destinationPath $platformDir -archiveType $build.archiveType
    
    # Find and copy FFmpeg binary
    $ffmpegSrc = Get-ChildItem -Path $extractDir -Recurse -Filter $build.exeName | Select-Object -First 1
    if ($ffmpegSrc) {
        Copy-Item $ffmpegSrc.FullName -Destination $destPath -Force
        Write-Host "FFmpeg copied to: $destPath"
    } else {
        Write-Warning "Could not find FFmpeg binary for $platform"
    }
    
    # Cleanup
    Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
}

Write-Host "`nFFmpeg setup complete for all platforms!"

# Create platform-specific permission scripts with proper shell script syntax
$unixPermScript = @'
#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
chmod +x "$SCRIPT_DIR/ffmpeg"
'@

# Save permission scripts with Unix line endings
$darwinPermPath = Join-Path (Join-Path $binDir "darwin") "set-permissions.sh"
$linuxPermPath = Join-Path (Join-Path $binDir "linux") "set-permissions.sh"

# Create directories if they don't exist
New-Item -ItemType Directory -Force -Path (Split-Path $darwinPermPath) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $linuxPermPath) | Out-Null

# Write the scripts with Unix line endings
$unixPermScript.Replace("`r`n", "`n") | Set-Content -NoNewline -Path $darwinPermPath -Encoding UTF8
$unixPermScript.Replace("`r`n", "`n") | Set-Content -NoNewline -Path $linuxPermPath -Encoding UTF8

Write-Host "Permission scripts created successfully" 
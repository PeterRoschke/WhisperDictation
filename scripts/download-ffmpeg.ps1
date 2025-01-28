# Download and setup FFmpeg binaries for the extension
$ErrorActionPreference = "Stop"

# Create directories if they don't exist
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$binDir = Join-Path $rootDir "resources\bin"
$win32Dir = Join-Path $binDir "win32"
$cacheDir = Join-Path $env:LOCALAPPDATA "WhisperDictation\cache"

# Note: For MacOS/Linux installers, you would create these directories:
# $darwinDir = Join-Path $binDir "darwin"  # For MacOS
# $linuxDir = Join-Path $binDir "linux"    # For Linux

# Create directories
New-Item -ItemType Directory -Force -Path $win32Dir | Out-Null
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

# Define FFmpeg build for Windows
# Note: For MacOS/Linux installers, add similar configurations following this pattern
$ffmpegBuild = @{
    url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n6.1-latest-win64-gpl-6.1.zip"
    exeName = "ffmpeg.exe"
    cached = Join-Path $cacheDir "ffmpeg-win32.zip"
    dest = Join-Path $win32Dir "ffmpeg.exe"
}

# Example configurations for other platforms (commented out):
# MacOS:
# url = "https://evermeet.cx/ffmpeg/getrelease/zip"
# exeName = "ffmpeg"
# cached = Join-Path $cacheDir "ffmpeg-darwin.zip"
# dest = Join-Path $darwinDir "ffmpeg"
#
# Linux:
# url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n6.1-latest-linux64-gpl-6.1.tar.xz"
# exeName = "ffmpeg"
# cached = Join-Path $cacheDir "ffmpeg-linux.tar.xz"
# dest = Join-Path $linuxDir "ffmpeg"

# Skip if FFmpeg already exists
if (Test-Path $ffmpegBuild.dest) {
    Write-Host "FFmpeg already exists, skipping..."
    exit 0
}

Write-Host "Processing FFmpeg for Windows..."

# Download if not in cache
if (-not (Test-Path $ffmpegBuild.cached)) {
    Write-Host "Downloading FFmpeg..."
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($ffmpegBuild.url, $ffmpegBuild.cached)
} else {
    Write-Host "Using cached FFmpeg..."
}

# Create temp extraction directory
$extractDir = Join-Path $env:TEMP "ffmpeg-temp"
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

# Extract and copy FFmpeg
Write-Host "Extracting FFmpeg..."
Expand-Archive -Path $ffmpegBuild.cached -DestinationPath $extractDir -Force
$ffmpegSrc = Get-ChildItem -Path $extractDir -Recurse -Filter $ffmpegBuild.exeName | Select-Object -First 1
Copy-Item $ffmpegSrc.FullName -Destination $ffmpegBuild.dest

# Cleanup
Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue

Write-Host "FFmpeg setup complete!"

# Note: For MacOS/Linux installers:
# 1. Create similar scripts named download-ffmpeg.sh
# 2. Use appropriate download URLs and extraction methods
# 3. Set executable permissions (chmod +x) after extraction
# 4. Consider platform-specific compression formats (zip vs tar.gz) 
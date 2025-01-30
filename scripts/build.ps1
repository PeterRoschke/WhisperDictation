param(
    [switch]$NoClean = $false
)

# Stop on any error
$ErrorActionPreference = "Stop"

Write-Host "Starting extension build..." -ForegroundColor Cyan

# Clean by default unless explicitly skipped
if (-not $NoClean) {
    # Clean build artifacts but preserve FFmpeg binaries
    Write-Host "Cleaning build artifacts..." -ForegroundColor Yellow
    # Windows-specific FFmpeg path
    $ffmpegDir = Join-Path $PSScriptRoot "..\resources\bin\win32"
    $tempFFmpegDir = Join-Path $env:TEMP "ffmpeg-backup"

    # Note: When creating MacOS/Linux installers, follow this pattern but use:
    # MacOS: "..\resources\bin\darwin"
    # Linux: "..\resources\bin\linux"
    
    # Backup FFmpeg binaries if they exist
    if (Test-Path $ffmpegDir) {
        Write-Host "Backing up FFmpeg binaries..." -ForegroundColor Yellow
        Copy-Item -Path $ffmpegDir -Destination $tempFFmpegDir -Recurse -Force
    }

    # Clean dist and vsix files
    if (Test-Path "dist") {
        Remove-Item -Recurse -Force "dist"
    }
    if (Test-Path "*.vsix") {
        Remove-Item -Force "*.vsix"
    }

    # Restore FFmpeg binaries
    if (Test-Path $tempFFmpegDir) {
        Write-Host "Restoring FFmpeg binaries..." -ForegroundColor Yellow
        if (-not (Test-Path $ffmpegDir)) {
            New-Item -ItemType Directory -Force -Path $ffmpegDir | Out-Null
        }
        Copy-Item -Path "$tempFFmpegDir\*" -Destination $ffmpegDir -Recurse -Force
        Remove-Item -Path $tempFFmpegDir -Recurse -Force
    }
}

# Install dependencies if node_modules doesn't exist
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install --no-audit --no-fund
}

# Download FFmpeg if not present (Windows only)
# Note: For MacOS/Linux installers, create similar scripts that download the appropriate binaries
# Example paths:
# MacOS: "..\resources\bin\darwin\ffmpeg"
# Linux: "..\resources\bin\linux\ffmpeg"
if (-not (Test-Path (Join-Path $PSScriptRoot "..\resources\bin\win32\ffmpeg.exe"))) {
    Write-Host "Downloading FFmpeg binaries..." -ForegroundColor Yellow
    npm run download-ffmpeg
}

# Build and package in one step
Write-Host "Creating VSIX package..." -ForegroundColor Yellow
npx vsce package

# Get the created VSIX file
$vsixFile = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
if (-not $vsixFile) {
    throw "Failed to find .vsix file!"
}

Write-Host "`nBuild completed successfully!" -ForegroundColor Green
Write-Host "`nTo install the extension:" -ForegroundColor Yellow
Write-Host "1. Open Cursor" -ForegroundColor Yellow
Write-Host "2. Press Ctrl+Shift+P (or Cmd+Shift+P on macOS)" -ForegroundColor Yellow
Write-Host "3. Type 'Extensions: Install from VSIX'" -ForegroundColor Yellow
Write-Host "4. Select this file: $($vsixFile.FullName)" -ForegroundColor Yellow
Write-Host "5. Restart Cursor" -ForegroundColor Yellow 


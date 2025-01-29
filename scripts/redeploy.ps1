param(
    [switch]$Clean = $false
)

# Stop on any error
$ErrorActionPreference = "Stop"

Write-Host "Starting extension redeployment..." -ForegroundColor Cyan

# Only clean if explicitly requested
if ($Clean) {
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

# Build and package in one step (avoids running webpack twice)
Write-Host "Building and packaging extension..." -ForegroundColor Yellow
npm run package

# Get the extension installation path
$extensionName = "local-publisher.whipserdictation"
$extensionDir = Join-Path $env:USERPROFILE ".vscode-insiders\extensions\$extensionName"
$cursorExtensionDir = Join-Path $env:USERPROFILE ".cursor\extensions\$extensionName"

# Function to deploy to a specific directory
function Deploy-Extension {
    param (
        [string]$targetDir
    )
    
    if (Test-Path $targetDir) {
        Write-Host "Removing existing extension from $targetDir..." -ForegroundColor Yellow
        # Use robocopy to empty the directory - this is more reliable with file locks
        robocopy /MIR $env:TEMP\empty_dir $targetDir | Out-Null
        Remove-Item -Path $targetDir -Recurse -Force -ErrorAction SilentlyContinue
    }

    Write-Host "Installing extension to $targetDir..." -ForegroundColor Yellow
    $vsixFile = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
    if (-not $vsixFile) {
        Write-Host "Failed to find .vsix file!" -ForegroundColor Red
        exit 1
    }

    # Create a temporary zip file from the vsix
    $tempZip = Join-Path $env:TEMP "temp_extension.zip"
    Copy-Item -Path $vsixFile.FullName -Destination $tempZip -Force

    try {
        # Create target directory if it doesn't exist
        if (-not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }

        # Extract the zip to the extension directory
        Expand-Archive -Path $tempZip -DestinationPath $targetDir -Force

        # Clean up temp zip
        Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
    }
    catch {
        Write-Host "Error deploying extension: $_" -ForegroundColor Red
        if (Test-Path $tempZip) {
            Remove-Item -Path $tempZip -Force -ErrorAction SilentlyContinue
        }
        exit 1
    }
}

# Deploy to both VS Code Insiders and Cursor locations
Deploy-Extension $extensionDir
Deploy-Extension $cursorExtensionDir

Write-Host "Extension deployed successfully!" -ForegroundColor Green
Write-Host "To reload the extension:" -ForegroundColor Yellow
Write-Host "1. Open the Command Palette (Ctrl+Shift+P)" -ForegroundColor Yellow
Write-Host "2. Type 'Reload Window' to reload the entire window if needed" -ForegroundColor Yellow 


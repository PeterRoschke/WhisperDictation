param(
    [switch]$InPlace = $false
)

# Stop on any error
$ErrorActionPreference = "Stop"

Write-Host "Starting extension redeployment..." -ForegroundColor Cyan

# Uninstall existing extension
Write-Host "Uninstalling existing extension..." -ForegroundColor Yellow
try {
    cursor --uninstall-extension undefined_publisher.whipserdictation
} catch {
    Write-Host "Extension not installed, continuing..." -ForegroundColor Yellow
}

# Clean build artifacts but preserve FFmpeg binaries
Write-Host "Cleaning build artifacts..." -ForegroundColor Yellow
$ffmpegDir = Join-Path $PSScriptRoot "resources\bin"
$tempFFmpegDir = Join-Path $env:TEMP "ffmpeg-backup"

# Backup FFmpeg binaries if they exist
if (Test-Path $ffmpegDir) {
    Write-Host "Backing up FFmpeg binaries..." -ForegroundColor Yellow
    Copy-Item -Path $ffmpegDir -Destination $tempFFmpegDir -Recurse -Force
}

if (Test-Path "dist") {
    Remove-Item -Recurse -Force "dist"
}
if (Test-Path "*.vsix") {
    Remove-Item -Force "*.vsix"
}

# Install dependencies and build
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install

# Restore FFmpeg binaries
if (Test-Path $tempFFmpegDir) {
    Write-Host "Restoring FFmpeg binaries..." -ForegroundColor Yellow
    if (-not (Test-Path $ffmpegDir)) {
        New-Item -ItemType Directory -Force -Path $ffmpegDir | Out-Null
    }
    Copy-Item -Path "$tempFFmpegDir\*" -Destination $ffmpegDir -Recurse -Force
    Remove-Item -Path $tempFFmpegDir -Recurse -Force
} else {
    # Download FFmpeg if not present
    Write-Host "Downloading FFmpeg binaries..." -ForegroundColor Yellow
    npm run download-ffmpeg
}

Write-Host "Building extension..." -ForegroundColor Yellow
npm run compile

Write-Host "Packaging extension..." -ForegroundColor Yellow
npx vsce package --allow-missing-repository --no-dependencies --no-yarn

# Install the extension
Write-Host "Installing extension..." -ForegroundColor Yellow
$vsixFile = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
if ($vsixFile) {
    cursor --install-extension $vsixFile.Name
    Write-Host "Extension redeployed successfully!" -ForegroundColor Green
    
    if ($InPlace) {
        Write-Host "Press Ctrl+R Ctrl+R in VS Code to reload the window." -ForegroundColor Yellow
    } else {
        Write-Host "Please restart Cursor to load the updated extension." -ForegroundColor Yellow
    }
} else {
    Write-Host "Failed to find .vsix file!" -ForegroundColor Red
    exit 1
}

Write-Host "Deploying extension..."
$extensionPath = "$env:USERPROFILE\.vscode\extensions\whisperdictation"
Remove-Item -Path $extensionPath -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item -Path "." -Destination $extensionPath -Recurse

if ($InPlace) {
    Write-Host "Extension deployed. Press Ctrl+R Ctrl+R in VS Code to reload the window."
} else {
    Write-Host "Extension deployed. Please restart VS Code to load the new version."
    Write-Host "TIP: You can use -InPlace switch to deploy without requiring a restart."
} 

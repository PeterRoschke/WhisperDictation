param(
    [switch]$NoClean = $false
)

# Stop on any error
$ErrorActionPreference = "Stop"

Write-Host "Starting extension build..." -ForegroundColor Cyan

# Clean by default unless explicitly skipped
if (-not $NoClean) {
    Write-Host "Cleaning build artifacts..." -ForegroundColor Yellow
    
    # Clean dist and vsix files
    if (Test-Path "dist") {
        Remove-Item -Recurse -Force "dist"
    }
    if (Test-Path "*.vsix") {
        Remove-Item -Force "*.vsix"
    }
}

# Install dependencies if node_modules doesn't exist
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    npm install --no-audit --no-fund
}

# Check if SoX exists before downloading
$rootPath = Join-Path -Path $PSScriptRoot -ChildPath ".." -Resolve
$resourcesPath = Join-Path -Path $rootPath -ChildPath "resources"
$binPath = Join-Path -Path $resourcesPath -ChildPath "bin"
$win32Path = Join-Path -Path $binPath -ChildPath "win32"
$soxPath = Join-Path -Path $win32Path -ChildPath "sox.exe"

Write-Host "Checking for SoX at: $soxPath" -ForegroundColor Gray

if (-not (Test-Path $soxPath)) {
    Write-Host "SoX not found, downloading..." -ForegroundColor Yellow
    npm run download-sox
} else {
    Write-Host "SoX already installed, verifying..." -ForegroundColor Green
    # Verify the installation
    try {
        $soxVersion = & $soxPath --version 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "Found SoX version: $soxVersion" -ForegroundColor Green
        } else {
            Write-Host "SoX installation appears corrupted, re-downloading..." -ForegroundColor Yellow
            npm run download-sox
        }
    } catch {
        Write-Host "Error verifying SoX installation, re-downloading..." -ForegroundColor Yellow
        Write-Host "Error details: $_" -ForegroundColor Red
        npm run download-sox
    }
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


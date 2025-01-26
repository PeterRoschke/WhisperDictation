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

# Clean build artifacts
Write-Host "Cleaning build artifacts..." -ForegroundColor Yellow
if (Test-Path "dist") {
    Remove-Item -Recurse -Force "dist"
}
if (Test-Path "*.vsix") {
    Remove-Item -Force "*.vsix"
}

# Install dependencies and build
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install

Write-Host "Building extension..." -ForegroundColor Yellow
npm run compile

Write-Host "Packaging extension..." -ForegroundColor Yellow
vsce package --allow-missing-repository --no-dependencies --no-yarn

# Install the extension
Write-Host "Installing extension..." -ForegroundColor Yellow
$vsixFile = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
if ($vsixFile) {
    cursor --install-extension $vsixFile.Name
    Write-Host "Extension redeployed successfully!" -ForegroundColor Green
    Write-Host "Please restart Cursor to load the updated extension." -ForegroundColor Yellow
} else {
    Write-Host "Failed to find .vsix file!" -ForegroundColor Red
    exit 1
} 
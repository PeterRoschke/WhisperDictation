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
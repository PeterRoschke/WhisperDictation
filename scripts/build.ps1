param(
    [switch]$NoClean = $false
)

# Stop on any error
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

# Track temporary files for cleanup
$tempFiles = @()
$tempDirs = @()

function Register-TempFile {
    param([string]$Path, [bool]$IsDirectory = $false)
    if ($IsDirectory) {
        $tempDirs += $Path
    } else {
        $tempFiles += $Path
    }
}

function Cleanup-TempFiles {
    foreach ($file in $tempFiles) {
        if (Test-Path -Path $file) {
            Remove-Item -Path $file -Force
            Write-Host "Cleaned up temporary file: $file"
        }
    }
    foreach ($dir in $tempDirs) {
        if (Test-Path -Path $dir) {
            Remove-Item -Path $dir -Recurse -Force
            Write-Host "Cleaned up temporary directory: $dir"
        }
    }
}

Write-Step "Starting WhisperDictation Extension Build"

try {
    # Clean build artifacts but preserve resources
    if (-not $NoClean) {
        Write-Step "Cleaning build artifacts"
        npm run clean
        if ($LASTEXITCODE -ne 0) {
            throw "Clean step failed"
    }
}

# Install dependencies if node_modules doesn't exist
if (-not (Test-Path "node_modules")) {
        Write-Step "Installing NPM dependencies"
    npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "NPM install failed"
        }
}

    # Setup paths
$rootPath = Join-Path -Path $PSScriptRoot -ChildPath ".." -Resolve
$resourcesPath = Join-Path -Path $rootPath -ChildPath "resources"
$binPath = Join-Path -Path $resourcesPath -ChildPath "bin"
$win32Path = Join-Path -Path $binPath -ChildPath "win32"
    $darwinPath = Join-Path -Path $binPath -ChildPath "darwin"
    $linuxPath = Join-Path -Path $binPath -ChildPath "linux"

    # Create platform directories if they don't exist
    Write-Step "Setting up platform directories"
    @($win32Path, $darwinPath, $linuxPath) | ForEach-Object {
        if (-not (Test-Path $_)) {
            New-Item -Path $_ -ItemType Directory -Force | Out-Null
            Write-Host "Created directory: $_"
        }
    }

    # Function to verify Windows SoX installation
    function Test-WindowsSox {
        param([string]$Path)
        
        if (-not (Test-Path $Path)) { return $false }
        
        # Check for required DLLs
        $requiredDlls = @(
            "libsox-3.dll",
            "libvorbis-0.dll",
            "libvorbisenc-2.dll",
            "libvorbisfile-3.dll",
            "libogg-0.dll"
        )
        
        foreach ($dll in $requiredDlls) {
            if (-not (Test-Path (Join-Path -Path $win32Path -ChildPath $dll))) {
                Write-Host "Missing required DLL: $dll" -ForegroundColor Yellow
                return $false
            }
        }
        
        # Test SoX functionality
        try {
            $soxVersion = & $Path --version 2>&1
        if ($LASTEXITCODE -eq 0) {
                Write-Host "Found Windows SoX version: $soxVersion" -ForegroundColor Green
                return $true
            }
        } catch {
            Write-Host "Error testing SoX: $_" -ForegroundColor Red
        }
        return $false
    }

    # Download and verify SoX for Windows
    Write-Step "Setting up Windows binaries"
    $soxPath = Join-Path -Path $win32Path -ChildPath "sox.exe"
    if (-not (Test-WindowsSox -Path $soxPath)) {
        Write-Host "Windows SoX missing or incomplete, downloading..." -ForegroundColor Yellow
        npm run download-sox
        if ($LASTEXITCODE -ne 0) {
            throw "Windows SoX download failed"
        }
        # Verify after download
        if (-not (Test-WindowsSox -Path $soxPath)) {
            throw "Windows SoX verification failed after download"
        }
    } else {
        Write-Host "Windows SoX installation verified" -ForegroundColor Green
    }

    # Function to verify macOS SoX installation
    function Test-MacSox {
        param([string]$DarwinPath)
        
        $soxBinary = Join-Path -Path $DarwinPath -ChildPath "sox"
        if (-not (Test-Path $soxBinary)) {
            Write-Host "macOS SoX binary not found" -ForegroundColor Yellow
            return $false
        }

        # For macOS, we only need the statically linked executable
        return $true
    }

    # Setup macOS binaries
    Write-Step "Setting up macOS binaries"
    if (Test-MacSox -DarwinPath $darwinPath) {
        Write-Host "Using existing macOS SoX installation" -ForegroundColor Green
    } else {
        Write-Host "macOS SoX missing, downloading..." -ForegroundColor Yellow
        
        # Create temp directory for downloads
        $tempMacDir = Join-Path -Path $env:TEMP -ChildPath "sox_mac_temp"
        Write-Host "Using temporary directory: $tempMacDir" -ForegroundColor Cyan
        Register-TempFile -Path $tempMacDir -IsDirectory $true
        
        if (Test-Path $tempMacDir) {
            Write-Host "Cleaning existing temp directory..." -ForegroundColor Cyan
            Remove-Item -Path $tempMacDir -Recurse -Force
        }
        New-Item -Path $tempMacDir -ItemType Directory -Force | Out-Null

        try {
            # Download macOS SoX from SourceForge
            $soxVersion = "14.4.2"
            $soxUrl = "https://sourceforge.net/projects/sox/files/sox/$soxVersion/sox-$soxVersion-macosx.zip/download"
            $soxZip = Join-Path -Path $tempMacDir -ChildPath "sox.zip"
            Write-Host "Downloading macOS SoX from: $soxUrl" -ForegroundColor Cyan
            Write-Host "Downloading to: $soxZip" -ForegroundColor Cyan
            
            $webClient = New-Object System.Net.WebClient
            $webClient.DownloadFile($soxUrl, $soxZip)

            # Verify download size
            $downloadSize = (Get-Item $soxZip).Length
            Write-Host "Download completed. File size: $downloadSize bytes" -ForegroundColor Cyan

            # Extract the zip
            Write-Host "Extracting to: $tempMacDir" -ForegroundColor Cyan
            Expand-Archive -Path $soxZip -DestinationPath $tempMacDir -Force
            
            # Enhanced directory listing
            Write-Host "`nDetailed contents of temp directory after extraction:" -ForegroundColor Cyan
            Write-Host "----------------------------------------" -ForegroundColor Cyan
            Get-ChildItem -Path $tempMacDir -Recurse | ForEach-Object {
                $indent = "  " * ($_.FullName.Split([IO.Path]::DirectorySeparatorChar).Count - $tempMacDir.Split([IO.Path]::DirectorySeparatorChar).Count)
                $itemType = if ($_.PSIsContainer) { "DIR" } else { "FILE" }
                $size = if ($_.PSIsContainer) { "" } else { "$($_.Length) bytes" }
                Write-Host "$indent[$itemType] $($_.Name) $size" -ForegroundColor Gray
                
                # If it's the sox-14.4.2 directory, list its contents too
                if ($_.Name -eq "sox-14.4.2" -and $_.PSIsContainer) {
                    Get-ChildItem -Path $_.FullName | ForEach-Object {
                        $subIndent = "$indent  "
                        $subItemType = if ($_.PSIsContainer) { "DIR" } else { "FILE" }
                        $subSize = if ($_.PSIsContainer) { "" } else { "$($_.Length) bytes" }
                        Write-Host "$subIndent[$subItemType] $($_.Name) $subSize" -ForegroundColor Gray
                    }
                }
            }
            Write-Host "----------------------------------------`n" -ForegroundColor Cyan

            # Try to find the sox binary
            Write-Host "Searching for sox binary..." -ForegroundColor Cyan
            $possibleSoxPaths = @(
                (Join-Path -Path $tempMacDir -ChildPath "sox"),
                (Join-Path -Path $tempMacDir -ChildPath "sox-14.4.2" | Join-Path -ChildPath "sox")
            )

            $foundSoxPath = $null
            foreach ($path in $possibleSoxPaths) {
                Write-Host "Checking path: $path" -ForegroundColor Gray
                if (Test-Path $path) {
                    # Check file size to ensure it's not a tiny placeholder
                    $fileSize = (Get-Item $path).Length
                    if ($fileSize -gt 1000000) {  # Should be over 1MB
                        $foundSoxPath = $path
                        Write-Host "Found sox binary at: $path (Size: $fileSize bytes)" -ForegroundColor Green
                        break
                    } else {
                        Write-Host "Found file at $path but it seems too small (Size: $fileSize bytes)" -ForegroundColor Yellow
                    }
                }
            }

            if (-not $foundSoxPath) {
                Write-Host "Contents of sox-14.4.2 directory (if it exists):" -ForegroundColor Cyan
                $sox142Dir = Join-Path -Path $tempMacDir -ChildPath "sox-14.4.2"
                if (Test-Path $sox142Dir) {
                    Get-ChildItem -Path $sox142Dir | ForEach-Object {
                        Write-Host "  $($_.Name) - $($_.Length) bytes" -ForegroundColor Gray
                    }
                }
                throw "Could not find valid sox binary in any expected location"
            }

            # Copy the sox binary
            $targetPath = Join-Path -Path $darwinPath -ChildPath "sox"
            Write-Host "Copying sox binary from $foundSoxPath to $targetPath" -ForegroundColor Cyan
            Copy-Item -Path $foundSoxPath -Destination $targetPath -Force

            # Set executable permission marker for macOS
            $chmodPath = Join-Path -Path $darwinPath -ChildPath ".chmod"
            "755" | Out-File -FilePath $chmodPath -Encoding utf8 -NoNewline
            Write-Host "Created chmod marker file: $chmodPath" -ForegroundColor Cyan

            # Verify the installation
            Write-Host "Verifying macOS SoX installation..." -ForegroundColor Cyan
            if (-not (Test-MacSox -DarwinPath $darwinPath)) {
                throw "macOS SoX installation verification failed after download"
            }

            Write-Host "macOS SoX setup completed" -ForegroundColor Green
        } catch {
            Write-Host "Error setting up macOS SoX: $_" -ForegroundColor Red
            Write-Host "Stack Trace:" -ForegroundColor Red
            Write-Host $_.ScriptStackTrace -ForegroundColor Red
            throw "macOS SoX setup failed: $_"
        }
    }

    # Setup Linux instructions and script
    Write-Step "Setting up Linux files"
    $linuxScript = @'
#!/bin/bash

# Function to detect the package manager and install SoX
install_sox() {
    if command -v apt-get &> /dev/null; then
        echo "Detected Debian/Ubuntu-based system"
        sudo apt-get update
        sudo apt-get install -y sox
    elif command -v dnf &> /dev/null; then
        echo "Detected Fedora/RHEL-based system"
        sudo dnf install -y sox
    elif command -v pacman &> /dev/null; then
        echo "Detected Arch Linux-based system"
        sudo pacman -S --noconfirm sox
    else
        echo "Could not detect package manager. Please install SoX manually."
        exit 1
    }
}

# Function to check and set audio permissions
setup_permissions() {
    # Check if user is in audio group
    if ! groups | grep -q audio; then
        echo "Adding user to audio group..."
        sudo usermod -a -G audio $USER
        echo "NOTE: You may need to log out and back in for group changes to take effect"
    fi

    # Check if pulseaudio is running and user has access
    if command -v pulseaudio &> /dev/null; then
        if ! groups | grep -q pulse-access; then
            echo "Adding user to pulse-access group..."
            sudo usermod -a -G pulse-access $USER
            echo "NOTE: You may need to log out and back in for group changes to take effect"
        fi
    fi
}

# Check if SoX is already installed
if ! command -v sox &> /dev/null; then
    echo "SoX is not installed. Installing now..."
    install_sox
else
    echo "SoX is already installed"
fi

# Setup audio permissions
setup_permissions

# Test SoX installation
if ! sox --version &> /dev/null; then
    echo "ERROR: SoX installation appears to be broken"
    exit 1
fi

echo "SoX setup completed successfully"
echo "If you experience permission issues, try logging out and back in"
'@

    $linuxInstructions = @"
WhisperDictation Linux Setup Instructions

1. Make the setup script executable:
   chmod +x setup-sox.sh

2. Run the setup script:
   ./setup-sox.sh

The script will:
- Install SoX if not already installed
- Set up necessary audio permissions
- Add your user to required groups

If you prefer manual installation:

Ubuntu/Debian:
    sudo apt-get install sox

Fedora:
    sudo dnf install sox

Arch Linux:
    sudo pacman -S sox

After installation, ensure your user has proper audio permissions:
    sudo usermod -a -G audio,pulse-access $USER

NOTE: You may need to log out and back in for group changes to take effect.
"@

    $linuxScriptPath = Join-Path -Path $linuxPath -ChildPath "setup-sox.sh"
    $linuxInstructionsPath = Join-Path -Path $linuxPath -ChildPath "INSTALL.txt"
    
    # Write Linux script without BOM
    $utf8NoBomEncoding = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllLines($linuxScriptPath, $linuxScript.Split("`n"), $utf8NoBomEncoding)
    
    # Instructions can use regular UTF8
    $linuxInstructions | Out-File -FilePath $linuxInstructionsPath -Encoding utf8
    Write-Host "Linux setup files created" -ForegroundColor Green

    # Run webpack build
    Write-Step "Building extension with webpack"
    npm run compile
    if ($LASTEXITCODE -ne 0) {
        throw "Webpack build failed"
    }

    # Verify resources before packaging
    Write-Step "Verifying resources for packaging"
    $requiredFiles = @(
        (Join-Path -Path $win32Path -ChildPath "sox.exe"),
        (Join-Path -Path $darwinPath -ChildPath "sox"),
        (Join-Path -Path $linuxPath -ChildPath "setup-sox.sh"),
        (Join-Path -Path $linuxPath -ChildPath "INSTALL.txt")
    )

    foreach ($file in $requiredFiles) {
        if (-not (Test-Path -Path $file)) {
            throw "Required file missing: $file"
        }
        Write-Host "Verified: $file"
    }

    # Create VSIX package
    Write-Step "Creating VSIX package"
    npx vsce package --no-dependencies
    if ($LASTEXITCODE -ne 0) {
        throw "VSIX package creation failed"
    }

    # Verify VSIX was created
$vsixFile = Get-ChildItem -Filter "*.vsix" | Select-Object -First 1
if (-not $vsixFile) {
    throw "Failed to find .vsix file!"
}

    # Verify VSIX contents
    Write-Step "Verifying VSIX package"
    $vsixDir = Join-Path -Path $env:TEMP -ChildPath "vsix_verify"
    Register-TempFile -Path $vsixDir -IsDirectory $true

    if (Test-Path -Path $vsixDir) {
        Remove-Item -Path $vsixDir -Recurse -Force
    }
    New-Item -Path $vsixDir -ItemType Directory | Out-Null

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($vsixFile.FullName, $vsixDir)

    $resourcesInVsix = Join-Path -Path $vsixDir -ChildPath "extension\resources"
    if (-not (Test-Path -Path $resourcesInVsix)) {
        throw "Resources directory not found in VSIX package"
    }

    Write-Host "VSIX package verified successfully" -ForegroundColor Green

Write-Host "`nBuild completed successfully!" -ForegroundColor Green
Write-Host "`nTo install the extension:" -ForegroundColor Yellow
Write-Host "1. Open Cursor" -ForegroundColor Yellow
Write-Host "2. Press Ctrl+Shift+P (or Cmd+Shift+P on macOS)" -ForegroundColor Yellow
Write-Host "3. Type 'Extensions: Install from VSIX'" -ForegroundColor Yellow
Write-Host "4. Select this file: $($vsixFile.FullName)" -ForegroundColor Yellow
Write-Host "5. Restart Cursor" -ForegroundColor Yellow 
} catch {
    Write-Host "`nBuild failed!" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    exit 1
} finally {
    Write-Step "Cleaning up temporary files"
    Cleanup-TempFiles
} 


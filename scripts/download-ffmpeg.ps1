# Download and setup FFmpeg binaries for the extension
$ErrorActionPreference = "Stop"

# Create directories if they don't exist
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$binDir = Join-Path $rootDir "resources\bin"
$win32Dir = Join-Path $binDir "win32"
$darwinDir = Join-Path $binDir "darwin"
$linuxDir = Join-Path $binDir "linux"
$cacheDir = Join-Path $env:LOCALAPPDATA "WhisperDictation\cache"

# Create all directories
New-Item -ItemType Directory -Force -Path $win32Dir | Out-Null
New-Item -ItemType Directory -Force -Path $darwinDir | Out-Null
New-Item -ItemType Directory -Force -Path $linuxDir | Out-Null
New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null

# Define FFmpeg builds for each platform
$ffmpegBuilds = @{
    win32 = @{
        url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n6.1-latest-win64-gpl-6.1.zip"
        exeName = "ffmpeg.exe"
        cached = Join-Path $cacheDir "ffmpeg-win32.zip"
        dest = Join-Path $win32Dir "ffmpeg.exe"
    }
    darwin = @{
        url = "https://evermeet.cx/ffmpeg/getrelease/zip"
        exeName = "ffmpeg"
        cached = Join-Path $cacheDir "ffmpeg-darwin.zip"
        dest = Join-Path $darwinDir "ffmpeg"
    }
    linux = @{
        url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n6.1-latest-linux64-gpl-6.1.tar.xz"
        exeName = "ffmpeg"
        cached = Join-Path $cacheDir "ffmpeg-linux.tar.xz"
        dest = Join-Path $linuxDir "ffmpeg"
    }
}

foreach ($platform in $ffmpegBuilds.Keys) {
    $build = $ffmpegBuilds[$platform]
    
    # Skip if FFmpeg already exists for this platform
    if (Test-Path $build.dest) {
        Write-Host "FFmpeg for $platform already exists, skipping..."
        continue
    }

    Write-Host "Processing FFmpeg for $platform..."

    # Download if not in cache
    if (-not (Test-Path $build.cached)) {
        Write-Host "Downloading FFmpeg for $platform..."
        $webClient = New-Object System.Net.WebClient
        $webClient.DownloadFile($build.url, $build.cached)
    } else {
        Write-Host "Using cached FFmpeg for $platform..."
    }

    # Create temp extraction directory
    $extractDir = Join-Path $env:TEMP "ffmpeg-temp-$platform"
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

    # Extract and copy based on platform
    if ($platform -eq "win32") {
        Expand-Archive -Path $build.cached -DestinationPath $extractDir -Force
        $ffmpegSrc = Get-ChildItem -Path $extractDir -Recurse -Filter $build.exeName | Select-Object -First 1
        Copy-Item $ffmpegSrc.FullName -Destination $build.dest
    }
    elseif ($platform -eq "darwin") {
        Expand-Archive -Path $build.cached -DestinationPath $extractDir -Force
        $ffmpegSrc = Get-ChildItem -Path $extractDir -Recurse -Filter $build.exeName | Select-Object -First 1
        Copy-Item $ffmpegSrc.FullName -Destination $build.dest
        # Set executable permission (this won't work on Windows but will be needed on macOS)
        if ($IsLinux -or $IsMacOS) {
            chmod +x $build.dest
        }
    }
    elseif ($platform -eq "linux") {
        # Note: This extraction won't work on Windows, but the file will be in place for Linux
        Copy-Item $build.cached -Destination $build.dest
        # Set executable permission (this won't work on Windows but will be needed on Linux)
        if ($IsLinux) {
            chmod +x $build.dest
        }
    }

    # Cleanup
    Remove-Item -Recurse -Force $extractDir -ErrorAction SilentlyContinue
}

Write-Host "FFmpeg setup complete for all platforms!" 
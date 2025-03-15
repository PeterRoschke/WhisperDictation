#!/bin/bash

# Stop on any error
set -e

# Function to display section headers
function echo_step() {
    echo -e "\n=== $1 ==="
}

echo_step "Starting WhisperDictation Extension Build for Linux"

# Check if clean build is requested
CLEAN=false
if [ "$1" == "--clean" ]; then
    CLEAN=true
fi

# Clean build artifacts if requested
if [ "$CLEAN" == "true" ]; then
    echo_step "Cleaning build artifacts"
    npm run clean
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo_step "Installing NPM dependencies"
    npm install --no-audit --no-fund
fi

# Setup paths
ROOT_PATH=$(pwd)
RESOURCES_PATH="$ROOT_PATH/resources"
BIN_PATH="$RESOURCES_PATH/bin"
LINUX_PATH="$BIN_PATH/linux"

# Create platform directories if they don't exist
echo_step "Setting up platform directories"
mkdir -p "$LINUX_PATH"

# Verify Linux setup files
echo_step "Verifying Linux setup files"
if [ ! -f "$LINUX_PATH/setup-sox.sh" ] || [ ! -f "$LINUX_PATH/INSTALL.txt" ]; then
    echo "Creating Linux setup files..."
    
    # Create setup script
    cat > "$LINUX_PATH/setup-sox.sh" << 'EOF'
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
    fi
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
EOF

    # Create installation instructions
    cat > "$LINUX_PATH/INSTALL.txt" << 'EOF'
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
EOF

    # Make setup script executable
    chmod +x "$LINUX_PATH/setup-sox.sh"
    echo "Linux setup files created"
fi

# Run webpack build
echo_step "Building extension with webpack"
npm run compile

# Verify resources before packaging
echo_step "Verifying resources for packaging"
if [ ! -f "$LINUX_PATH/setup-sox.sh" ] || [ ! -f "$LINUX_PATH/INSTALL.txt" ]; then
    echo "ERROR: Required Linux files are missing"
    exit 1
fi
echo "Verified: Linux setup files"

# Create VSIX package
echo_step "Creating VSIX package"
npx vsce package --no-dependencies

# Verify VSIX was created
VSIX_FILE=$(ls *.vsix 2>/dev/null | head -n 1)
if [ -z "$VSIX_FILE" ]; then
    echo "ERROR: Failed to find .vsix file!"
    exit 1
fi

echo_step "Build completed successfully"
echo "Created package: $VSIX_FILE" 
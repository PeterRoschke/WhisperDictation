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

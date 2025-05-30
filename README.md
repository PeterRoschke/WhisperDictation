# WhisperDictation

A VS Code extension that enables voice dictation using OpenAI's Whisper API for speech-to-text transcription.

## Version

Current version: 0.1.0

Latest changes:
- Improved Linux compatibility and functionality

## Features

- Record audio directly from your system's default microphone
- Transcribe speech to text using OpenAI's Whisper API
- Support for multiple languages
- Optional debug file saving for troubleshooting

## Requirements

### Windows

- SoX is included in the package for Windows x64

### macOS

- Intel Macs: SoX is included in the package
- Apple Silicon (M1/M2) Macs: Install SoX via Homebrew:
  ```bash
  brew install sox
  ```

### Linux

- Install SoX using your distribution's package manager:

  ```bash
  # Ubuntu/Debian
  sudo apt-get install sox

  # Fedora
  sudo dnf install sox

  # Arch Linux
  sudo pacman -S sox
  ```

### All Platforms

- OpenAI API key
- A working microphone set as your system default input device

## Installation

1. Install the extension using the command palette (Ctrl+Shift+P):
   - Search for "Extensions: Install from VSIX..."
   - Select the WhisperDictation VSIX file
2. Set your OpenAI API key using the command palette (Ctrl+Shift+P):
   - Search for "Whisper Dictation: Update OpenAI API Key"
   - Enter your API key when prompted
   - Note: if you did not set a key or your key expired, the extension will prompt you for the key.
3. Ensure your desired microphone is set as the system default input device

## Usage

1. Click the microphone icon in the status bar
2. Speak into your microphone
3. Click the recording icon or press Ctrl+Insert again to stop recording
4. The transcription will be inserted at your cursor position

## Configuration

- `whisperdictation.language`: Set the transcription language (defaults to English)
- `whisperdictation.saveDebugFiles`: Enable saving of audio and transcription files for debugging to your defaut Application directory.

## Troubleshooting

If you encounter issues:

1. Check your microphone permissions in your system settings
2. Make sure your desired microphone is set as the system default input device
3. Verify your OpenAI API key is valid
4. Enable debug file saving to capture audio recordings for troubleshooting
5. Check the Output panel (View -> Output -> WhisperDictation) for detailed logs

## License

MIT

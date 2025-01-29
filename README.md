# WhisperDictation

A VS Code extension that adds speech-to-text capabilities using OpenAI's Whisper model.

## Features

- Start/stop dictation using the status bar button or keyboard shortcut
- Transcribe speech to text using OpenAI's Whisper model
- Support for multiple languages
- Automatic microphone selection and configuration using FFmpeg
- Configurable OpenAI API key with secure storage
- Automatic handling of expired or invalid API keys
- Debug recordings saved for troubleshooting

## Requirements

- An OpenAI API key
- A working microphone
- Windows OS (MacOS and Linux support planned)
- Node.js and npm (for building from source)

## Installation

### Building from Source

1. Download the source code
2. Run `scripts/redeploy.ps1` to set up the extension locally. This script will:
   - Install dependencies
   - Download necessary FFmpeg binaries (if not present)
   - Build and package the extension
   - Install it in your VS Code/Cursor environment
3. Reload your VS Code/Cursor window when prompted

The redeploy script handles all necessary setup, including:

- Installing npm dependencies
- Downloading and configuring FFmpeg
- Building and packaging the extension
- Installing it in the correct location

### After Installation

1. Set your OpenAI API key:

   - When first using the extension, you'll be prompted to enter your API key
   - You can update your API key anytime using the "Whisper Dictation: Update OpenAI API Key" command
   - Your API key is stored securely in the system's credential store
   - If your API key becomes invalid or expires, you'll be prompted to enter a new one

2. Configure your microphone:
   - Click the microphone icon in the status bar or use the "Whisper Dictation: Select Audio Device" command
   - Choose your preferred microphone from the list
   - The selection will be saved for future use

## Extension Settings

This extension contributes the following settings:

- `whipserdictation.language`: Language code for transcription (e.g., 'en' for English)
- `whipserdictation.audioDevice`: Selected audio input device (configured through UI)

## Usage

1. Start dictating:

   - Click the microphone icon in the status bar or use Ctrl+Insert to start recording
   - The icon will change to indicate recording is in progress
   - Click the icon again or use the same shortcut to stop recording

2. Using the transcription:
   - For cursor chat windows and composers in Cursor: Text will be automatically pasted
   - For other windows or applications: The text is automatically copied to your clipboard
   - Simply press Ctrl+V (or Cmd+V on Mac) to paste the transcribed text anywhere
   - A copy of the transcription is also saved in the DictationAudio folder for reference

## Available Commands

- "Whisper Dictation: Start Dictation" - Start/stop recording (Ctrl+Insert)
- "Whisper Dictation: Stop Dictation" - Stop recording and transcribe
- "Whisper Dictation: Update OpenAI API Key" - Update your OpenAI API key
- "Whisper Dictation: Select Audio Device" - Choose your input device
- "Whisper Dictation: Open Settings" - Open extension settings

## Development

For development work:

- Run `scripts/redeploy.ps1` to rebuild and deploy
- Use `scripts/redeploy.ps1 -Clean` for a clean rebuild
- The script automatically handles FFmpeg binaries during clean operations

## Known Issues

- Currently Windows-only (MacOS and Linux support should just require updating the deployment script)
- Automatic paste works only in chat and composer windows
- For other windows, manual paste (Ctrl+V) is required

## Release Notes

### 0.0.1

Initial release of WhisperDictation:

- Speech-to-text using OpenAI Whisper
- Automatic microphone selection using FFmpeg
- Multi-language support
- Secure API key storage
- Debug recording storage

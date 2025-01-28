# WhisperDictation

A VS Code extension that adds speech-to-text capabilities using OpenAI's Whisper model.

## Features

- Start/stop dictation using the status bar button or keyboard shortcut
- Transcribe speech to text using OpenAI's Whisper model
- Support for multiple languages
- Automatic microphone selection and configuration
- Configurable OpenAI API key with secure storage
- Automatic handling of expired or invalid API keys
- Debug recordings saved for troubleshooting

## Requirements

- An OpenAI API key
- A working microphone
- Windows OS (MacOS and Linux support planned)

## Extension Settings

This extension contributes the following settings:

- `whipserdictation.language`: Language code for transcription (e.g., 'en' for English)
- `whipserdictation.audioDevice`: Selected audio input device (configured through UI)

## Usage

1. Set your OpenAI API key:

   - When first using the extension, you'll be prompted to enter your API key
   - You can update your API key anytime using the "Whisper Dictation: Update OpenAI API Key" command
   - Your API key is stored securely in the system's credential store
   - If your API key becomes invalid or expires, you'll be prompted to enter a new one

2. Configure your microphone:

   - Click the microphone icon in the status bar or use the "Whisper Dictation: Select Audio Device" command
   - Choose your preferred microphone from the list
   - The selection will be saved for future use

3. Start dictating:

   - Click the microphone icon in the status bar or use Ctrl+Insert to start recording
   - The icon will change to indicate recording is in progress
   - Speak clearly into your microphone
   - Click the icon again or use the same shortcut to stop recording

4. Using the transcription:
   - For chat windows and composers in Cursor: Text will be automatically pasted
   - For other windows or applications: The text is automatically copied to your clipboard
   - Simply press Ctrl+V (or Cmd+V on Mac) to paste the transcribed text anywhere
   - A copy of the transcription is also saved in the DictationAudio folder for reference

## Available Commands

- "Whisper Dictation: Start Dictation" - Start/stop recording (Ctrl+Insert)
- "Whisper Dictation: Stop Dictation" - Stop recording and transcribe
- "Whisper Dictation: Update OpenAI API Key" - Update your OpenAI API key
- "Whisper Dictation: Select Audio Device" - Choose your input device
- "Whisper Dictation: Open Settings" - Open extension settings

## Development Setup

1. Clone the repository
2. Run `npm install` to install dependencies
3. Run `scripts/redeploy.ps1` to set up the extension locally. This script will:
   - Install dependencies
   - Download necessary ffmpeg binaries (if not present)
   - Build and package the extension
   - Install it in your VS Code/Cursor environment

For subsequent development:

- Run `scripts/redeploy.ps1` to rebuild and deploy
- Use `scripts/redeploy.ps1 -Clean` for a clean rebuild
- The script automatically handles ffmpeg binaries during clean operations

## Known Issues

- Currently Windows-only (MacOS and Linux support planned)
- Automatic paste works only in chat and composer windows
- For other windows, manual paste (Ctrl+V) is required

## Release Notes

### 0.0.1

Initial release of WhisperDictation:

- Speech-to-text using OpenAI Whisper
- Automatic microphone selection
- Multi-language support
- Secure API key storage
- Debug recording storage

# WhisperDictation

A VS Code extension that adds speech-to-text capabilities using OpenAI's Whisper model.

## Features

- Start/stop dictation using the status bar button or commands
- Transcribe speech to text in real-time
- Support for multiple languages
- Configurable OpenAI API key with easy update option
- Automatic handling of expired or invalid API keys

## Requirements

- An OpenAI API key
- A working microphone
- A modern browser-based environment (VS Code/Cursor)

## Extension Settings

This extension contributes the following settings:

- `whipserdictation.language`: Language code for transcription (e.g., 'en' for English)

## Usage

1. Set your OpenAI API key:
   - When first using the extension, you'll be prompted to enter your API key
   - You can update your API key anytime using the "Whisper Dictation: Update OpenAI API Key" command
   - If your API key becomes invalid or expires, you'll be prompted to enter a new one
2. Click the microphone icon in the status bar to start dictation
3. Allow microphone access when prompted
4. Speak clearly into your microphone
5. Click the microphone icon again to stop recording and transcribe

## Available Commands

- "Whisper Dictation: Start Dictation" - Start recording (also available via status bar)
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

- Use `scripts/redeploy.ps1 -InPlace` for faster redeployment without requiring a restart
- The script automatically handles ffmpeg binaries, backing them up during clean operations

## Known Issues

None at this time.

## Release Notes

### 0.0.1

Initial release of WhisperDictation

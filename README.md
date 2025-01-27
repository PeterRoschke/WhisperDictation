# WhisperDictation

A VS Code extension that adds speech-to-text capabilities using OpenAI's Whisper model.

## Features

- Start/stop dictation using keyboard shortcuts or commands
- Transcribe speech to text in real-time
- Support for multiple languages
- Configurable OpenAI API key

## Requirements

- An OpenAI API key
- A working microphone
- A modern browser-based environment (VS Code/Cursor)

## Extension Settings

This extension contributes the following settings:

- `whipserdictation.openAIApiKey`: Your OpenAI API key
- `whipserdictation.language`: Language code for transcription (e.g., 'en' for English)

## Usage

1. Set your OpenAI API key in the settings (use the "Whisper Dictation: Open Settings" command)
2. Press `Ctrl+Insert` (Windows/Linux) or `Cmd+Insert` (Mac) to start dictation
3. Allow microphone access when prompted
4. Speak clearly into your microphone
5. Use the "Stop Dictation" command to stop recording and transcribe

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

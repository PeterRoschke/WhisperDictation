# WhisperDictation

A VS Code extension that enables voice dictation using OpenAI's Whisper API for speech-to-text transcription.

## Features

- Record audio directly from your microphone
- Transcribe speech to text using OpenAI's Whisper API
- Support for multiple languages
- Configurable audio input device selection
- Optional debug file saving for troubleshooting

## Requirements

- SoX (automatically downloaded during installation)
- OpenAI API key

## Installation

1. Install the extension
2. Set your OpenAI API key using the command palette (Ctrl+Shift+P):
   - Search for "Whisper Dictation: Update OpenAI API Key"
   - Enter your API key when prompted

## Usage

1. Click the microphone icon in the status bar or press Ctrl+Insert to start recording
2. Speak into your microphone
3. Click the recording icon or press Ctrl+Insert again to stop recording
4. The transcription will be inserted at your cursor position

## Configuration

- `whisperdictation.language`: Set the transcription language (defaults to English)
- `whisperdictation.audioDevice`: Select the audio input device
- `whisperdictation.saveDebugFiles`: Enable saving of audio and transcription files for debugging

## Troubleshooting

If you encounter issues:

1. Check your microphone permissions
2. Verify your OpenAI API key is valid
3. Enable debug file saving to capture audio recordings for troubleshooting
4. Check the Output panel (View -> Output -> WhisperDictation) for detailed logs

## License

MIT

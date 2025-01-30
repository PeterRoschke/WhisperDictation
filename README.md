# WhisperDictation

Add Whisper Speech to Text typing to VS Code and Cursor.

## Features

- Record audio directly from your microphone
- Transcribe speech to text using OpenAI's Whisper model
- Support for multiple languages
- Configurable audio input device selection
- Automatic text insertion at cursor position

## Requirements

- OpenAI API key
- FFmpeg (automatically downloaded during installation)
- Windows, macOS, or Linux operating system

## Development

To build the extension:

1. Clone the repository
2. Run `.\scripts\build.ps1` to create a fresh build
   - Use `.\scripts\build.ps1 -NoClean` to skip cleaning build artifacts
3. The script will create a `.vsix` file in the root directory

To install the extension:

1. Open Cursor
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS)
3. Type "Extensions: Install from VSIX"
4. Select the `.vsix` file created by the build script
5. Restart Cursor

## Configuration

After installation:

1. Press `Ctrl+Shift+P` and type "Whisper Dictation: Update OpenAI API Key"
2. Enter your OpenAI API key when prompted
3. Optionally, select your preferred audio input device using "Whisper Dictation: Select Audio Device"

## Usage

1. Click the microphone icon in the status bar or press `Ctrl+Insert` to start recording
2. Speak into your microphone
3. Click the recording icon or press `Ctrl+Insert` again to stop and transcribe
4. The transcribed text will be inserted at your cursor position

## Settings

- `whisperdictation.language`: Language code for transcription (e.g., 'en' for English)
- `whisperdictation.audioDevice`: Selected audio input device (configured through UI)

## License

MIT

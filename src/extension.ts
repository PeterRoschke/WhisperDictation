/// <reference lib="dom" />

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import OpenAI from "openai";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";

let isRecording = false;
let recordingProcess: ReturnType<typeof spawn> | undefined;
let statusBarItem: vscode.StatusBarItem;
let openai: OpenAI | undefined;
let outputChannel: vscode.OutputChannel;
let tempFilePath: string | undefined;
let extensionContext: vscode.ExtensionContext;

interface RecordingError extends Error {
  message: string;
}

interface AudioDevice {
  name: string;
  id: string;
}

let availableDevices: AudioDevice[] = [];

// Helper function to get the ffmpeg binary path
function getFfmpegPath(): string {
  const platform = os.platform();
  const binDir = path.join(extensionContext.extensionPath, "resources", "bin");
  const ffmpegPath = path.join(
    binDir,
    platform === "win32" ? "win32/ffmpeg.exe" : platform === "darwin" ? "darwin/ffmpeg" : "linux/ffmpeg"
  );

  log(`Platform: ${platform}`);
  log(`FFmpeg path: ${ffmpegPath}`);
  log(`Extension path: ${extensionContext.extensionPath}`);

  return ffmpegPath;
}

async function openSettings() {
  await vscode.commands.executeCommand("workbench.action.openSettings", "whipserdictation");
}

async function promptForApiKey() {
  const action = await vscode.window.showErrorMessage(
    "OpenAI API key not configured. Please set your API key in settings.",
    "Open Settings"
  );

  if (action === "Open Settings") {
    await openSettings();
  }
}

// Helper function for logging
function log(message: string, error: boolean = false) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  outputChannel.appendLine(logMessage);
  if (error) {
    console.error(logMessage);
  } else {
    console.log(logMessage);
  }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;

  // Create output channel
  outputChannel = vscode.window.createOutputChannel("WhisperDictation");
  context.subscriptions.push(outputChannel);

  log("Extension activation started");
  log("Extension path: " + context.extensionPath);

  try {
    // Register settings command
    let openSettingsCmd = vscode.commands.registerCommand("whipserdictation.openSettings", openSettings);
    context.subscriptions.push(openSettingsCmd);

    // Create status bar item
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(unmute) Start Dictation";
    statusBarItem.command = "whipserdictation.startDictation";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    let startDictationCmd = vscode.commands.registerCommand("whipserdictation.startDictation", async () => {
      try {
        if (isRecording) {
          await stopRecording();
          return;
        }

        // Check API key
        const config = vscode.workspace.getConfiguration("whipserdictation");
        const apiKey = config.get<string>("openAIApiKey");
        if (!apiKey) {
          await promptForApiKey();
          return;
        }

        // Initialize OpenAI if needed
        if (!openai) {
          openai = new OpenAI({ apiKey });
        }

        // Initialize audio recorder
        await startRecording();
      } catch (error) {
        console.error("[WhisperDictation] Recording error:", error);
        vscode.window.showErrorMessage(`Failed to start recording: ${error instanceof Error ? error.message : String(error)}`);
        isRecording = false;
        statusBarItem.text = "$(unmute) Start Dictation";
      }
    });

    let stopDictationCmd = vscode.commands.registerCommand("whipserdictation.stopDictation", stopRecording);

    let listDevicesCmd = vscode.commands.registerCommand("whipserdictation.listDevices", listAudioDevices);

    let selectDeviceCmd = vscode.commands.registerCommand("whipserdictation.selectDevice", promptForDeviceSelection);

    context.subscriptions.push(startDictationCmd);
    context.subscriptions.push(stopDictationCmd);
    context.subscriptions.push(listDevicesCmd);
    context.subscriptions.push(selectDeviceCmd);

    // Verify command registration
    vscode.commands.getCommands(true).then((commands) => {
      console.log("[WhisperDictation] All registered commands after activation:", commands);
      console.log("[WhisperDictation] Checking if our commands are registered:");
      console.log("startDictation registered:", commands.includes("whipserdictation.startDictation"));
      console.log("stopDictation registered:", commands.includes("whipserdictation.stopDictation"));
      console.log("listDevices registered:", commands.includes("whipserdictation.listDevices"));
      console.log("selectDevice registered:", commands.includes("whipserdictation.selectDevice"));
    });

    log("Extension successfully activated");
  } catch (error) {
    log("Activation error: " + (error instanceof Error ? error.message : String(error)), true);
    throw error; // Re-throw to ensure VS Code sees the activation failure
  }
}

async function startRecording() {
  try {
    // Create temp file path
    tempFilePath = path.join(os.tmpdir(), `dictation-${Date.now()}.webm`);
    log(`Temp file path: ${tempFilePath}`);

    // Get ffmpeg path
    const ffmpegPath = getFfmpegPath();

    // Ensure ffmpeg exists
    if (!fs.existsSync(ffmpegPath)) {
      log(`FFmpeg not found at path: ${ffmpegPath}`, true);
      throw new Error(`FFmpeg not found at ${ffmpegPath}`);
    }
    log(`FFmpeg found at: ${ffmpegPath}`);

    // Get audio device
    const deviceId = await selectAudioDevice();

    // Build ffmpeg command for audio capture with platform-specific settings
    const platform = os.platform();
    let inputFormat: string;
    let inputDevice: string;

    switch (platform) {
      case "win32":
        inputFormat = "dshow";
        inputDevice = `audio=${deviceId}`; // Use selected device ID
        break;
      case "darwin":
        inputFormat = "avfoundation";
        inputDevice = ":0"; // Default macOS input device
        break;
      case "linux":
        inputFormat = "alsa";
        inputDevice = "default"; // Default ALSA device
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    log(`Using audio input: format=${inputFormat}, device=${inputDevice}`);

    const args = [
      "-hide_banner",
      "-f",
      inputFormat,
      "-audio_buffer_size",
      "50", // Small buffer for lower latency
      "-i",
      inputDevice,
      "-c:a",
      "libopus", // Opus codec (excellent for speech)
      "-ar",
      "16000", // 16kHz sample rate (optimal for Whisper)
      "-ac",
      "1", // Mono
      "-b:a",
      "20k", // 20kbps is excellent quality for speech with Opus
      "-application",
      "voip", // Optimize for speech
      "-frame_duration",
      "20", // 20ms frames (good for speech)
      "-packet_loss",
      "3", // Small packet loss resilience
      "-f",
      "webm", // WebM container
      "-y", // Overwrite output file
      tempFilePath, // Output file
    ];

    log(`Starting FFmpeg with command: ${ffmpegPath} ${args.join(" ")}`);

    // Start ffmpeg process
    recordingProcess = spawn(ffmpegPath, args);

    // Handle process events
    recordingProcess.stderr?.on("data", (data: Buffer) => {
      log(`[FFmpeg] ${data.toString().trim()}`);
    });

    recordingProcess.stdout?.on("data", (data: Buffer) => {
      log(`[FFmpeg stdout] ${data.toString().trim()}`);
    });

    recordingProcess.on("error", (err: Error) => {
      log(`FFmpeg error: ${err.message}`, true);
      throw err;
    });

    recordingProcess.on("exit", (code: number | null, signal: string | null) => {
      log(`FFmpeg process exited with code: ${code}, signal: ${signal}`);
    });

    isRecording = true;
    statusBarItem.text = "$(record) Recording... Click to Stop";
    log("Recording started successfully");
    vscode.window.showInformationMessage("Recording started! Press Ctrl+Insert or click the status bar icon to stop.");
  } catch (error) {
    log(`Failed to start recording: ${error}`, true);
    throw error;
  }
}

async function stopRecording() {
  if (!isRecording || !recordingProcess || !tempFilePath) {
    log("Stop recording called but recording is not active");
    return;
  }

  try {
    log("Stopping recording process...");
    // Stop recording gracefully
    recordingProcess.stdin?.write("q");

    // Wait for process to exit
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        log("FFmpeg process timeout, killing forcefully");
        recordingProcess?.kill();
        resolve();
      }, 1000);

      recordingProcess?.on("exit", () => {
        log("FFmpeg process exited normally");
        clearTimeout(timeout);
        resolve();
      });
    });

    // Add a small delay to ensure file is fully written
    log("Waiting for file to be written...");
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify the temp file exists and has content
    log(`Checking temp file: ${tempFilePath}`);
    if (!fs.existsSync(tempFilePath)) {
      log(`Temp file not found at: ${tempFilePath}`, true);
      throw new Error("Recording file not found. The recording may have failed.");
    }

    const stats = fs.statSync(tempFilePath);
    log(`Temp file size: ${stats.size} bytes`);
    if (stats.size === 0) {
      log("Temp file is empty", true);
      throw new Error("Recording file is empty. The recording may have failed.");
    }

    isRecording = false;
    statusBarItem.text = "$(unmute) Start Dictation";

    // Create debug directory if it doesn't exist
    const debugDir = path.join(extensionContext.extensionPath, "DictationAudio");
    log(`Debug directory path: ${debugDir}`);
    if (!fs.existsSync(debugDir)) {
      log(`Creating debug directory: ${debugDir}`);
      fs.mkdirSync(debugDir);
    }

    // Create debug file path
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const debugFilePath = path.join(debugDir, `dictation-${timestamp}.webm`);
    log(`Debug file path: ${debugFilePath}`);

    // Copy file to debug directory
    log(`Copying temp file to debug directory...`);
    fs.copyFileSync(tempFilePath, debugFilePath);
    log(`File copied successfully to: ${debugFilePath}`);

    if (!openai) {
      throw new Error("OpenAI client not initialized");
    }

    // Create a readable stream from the temp file
    const audioStream = fs.createReadStream(tempFilePath);

    // Log file details
    log(
      "Audio file details: " +
        JSON.stringify(
          {
            tempPath: tempFilePath,
            debugPath: debugFilePath,
            sizeInMB: (stats.size / (1024 * 1024)).toFixed(2) + " MB",
            format: "WebM",
            sampleRate: "16000 Hz",
            channels: "1 (mono)",
            bitrate: "20 kbps",
          },
          null,
          2
        )
    );

    // Call Whisper API
    const config = vscode.workspace.getConfiguration("whipserdictation");
    const transcription = await openai.audio.transcriptions.create({
      file: audioStream,
      model: "whisper-1",
      language: config.get<string>("language") || "en",
      response_format: "text",
    });

    console.log("[WhisperDictation] Transcription successful, length:", transcription.length);

    // Insert text
    try {
      await vscode.env.clipboard.writeText(transcription);
      await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
      log("Inserted text using paste command");
    } catch (insertError) {
      log(`Text insertion failed: ${insertError}`, true);
      vscode.window.showInformationMessage("Text copied to clipboard - press Ctrl+V/Cmd+V to paste");
    }

    // Write transcription to debug file
    fs.writeFileSync(debugFilePath + ".txt", transcription);

    vscode.window.showInformationMessage("Transcription complete!");
  } catch (error) {
    log("Transcription error: " + (error instanceof Error ? error.message : String(error)), true);
    vscode.window.showErrorMessage(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Clean up temp file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (error) {
        console.error("Failed to clean up temp file:", error);
      }
    }

    // Clean up recording process
    if (recordingProcess) {
      try {
        recordingProcess.kill();
      } catch (error) {
        console.error("Failed to kill recording process:", error);
      }
      recordingProcess = undefined;
    }

    tempFilePath = undefined;
  }
}

async function listAudioDevices(): Promise<void> {
  try {
    const ffmpegPath = getFfmpegPath();
    if (!fs.existsSync(ffmpegPath)) {
      throw new Error(`FFmpeg not found at ${ffmpegPath}`);
    }

    log("Listing available audio devices...");
    const args = ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"];

    const process = spawn(ffmpegPath, args);

    process.stderr?.on("data", (data: Buffer) => {
      const output = data.toString().trim();
      if (output.includes("DirectShow audio devices") || output.includes("Alternative name")) {
        log(output);
      }
    });

    await new Promise<void>((resolve) => {
      process.on("exit", () => resolve());
    });
  } catch (error) {
    log(`Failed to list audio devices: ${error}`, true);
  }
}

async function detectAudioDevices(): Promise<AudioDevice[]> {
  try {
    const ffmpegPath = getFfmpegPath();
    if (!fs.existsSync(ffmpegPath)) {
      throw new Error(`FFmpeg not found at ${ffmpegPath}`);
    }

    log("Detecting audio devices...");
    const args = ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"];

    const devices: AudioDevice[] = [];
    const process = spawn(ffmpegPath, args);

    // Collect device information
    process.stderr?.on("data", (data: Buffer) => {
      const output = data.toString().trim();
      if (output.includes("(audio)")) {
        const lines = output.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.includes("(audio)")) {
            const name = line.split('"')[1];
            // Get the next line which contains the device ID
            const idLine = lines[i + 1]?.trim();
            if (idLine && idLine.includes("Alternative name")) {
              const id = idLine.split('"')[1];
              devices.push({ name, id });
            }
          }
        }
      }
    });

    await new Promise<void>((resolve) => {
      process.on("exit", () => resolve());
    });

    log(`Found ${devices.length} audio devices:`);
    devices.forEach((device) => {
      log(`- ${device.name} (${device.id})`);
    });

    return devices;
  } catch (error) {
    log(`Failed to detect audio devices: ${error}`, true);
    return [];
  }
}

async function selectAudioDevice(): Promise<string> {
  // Update available devices
  availableDevices = await detectAudioDevices();

  if (availableDevices.length === 0) {
    throw new Error("No audio devices found");
  }

  // Get configured device from settings
  const config = vscode.workspace.getConfiguration("whipserdictation");
  const configuredDevice = config.get<string>("audioDevice");

  // If a device is configured, check if it's available
  if (configuredDevice) {
    const device = availableDevices.find((d) => d.id === configuredDevice);
    if (device) {
      log(`Using configured audio device: ${device.name}`);
      return device.id;
    }
    log(`Configured device not found: ${configuredDevice}`, true);
  }

  // Use first available device
  log(`Using first available audio device: ${availableDevices[0].name}`);
  return availableDevices[0].id;
}

async function promptForDeviceSelection(): Promise<void> {
  // Update available devices
  availableDevices = await detectAudioDevices();

  if (availableDevices.length === 0) {
    vscode.window.showErrorMessage("No audio devices found");
    return;
  }

  // Create QuickPick items
  const items = availableDevices.map((device) => ({
    label: device.name,
    description: device.id,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: "Select audio input device",
  });

  if (selected) {
    // Save to settings
    const config = vscode.workspace.getConfiguration("whipserdictation");
    await config.update("audioDevice", selected.description, true);
    vscode.window.showInformationMessage(`Audio device set to: ${selected.label}`);
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  if (isRecording && recordingProcess) {
    recordingProcess.kill();
  }
  recordingProcess = undefined;
  openai = undefined;
}

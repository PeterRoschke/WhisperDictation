/// <reference lib="dom" />

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import OpenAI from "openai";

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";

// Global state
let isRecording = false;

let recordingProcess: ReturnType<typeof spawn> | undefined;
let statusBarItem: vscode.StatusBarItem;
let openai: OpenAI | undefined;
let outputChannel: vscode.OutputChannel;
let tempFilePath: string | undefined;
let extensionContext: vscode.ExtensionContext;
let recordingTimer: NodeJS.Timeout | undefined;
let currentAudioDevice: AudioDevice | undefined;

const OPENAI_API_KEY_SECRET = "openai-api-key";

// Type definitions
interface AudioDevice {
  name: string;
  id: string;
}

let availableDevices: AudioDevice[] = [];

// Add reset function after the global state declarations
function resetRecordingState() {
  // Clear recording timer
  if (recordingTimer) {
    clearTimeout(recordingTimer);
    recordingTimer = undefined;
  }

  // Kill any existing recording process
  if (recordingProcess) {
    try {
      recordingProcess.kill();
    } catch (error) {
      log("Error killing recording process: " + error, true);
    }
    recordingProcess = undefined;
  }

  // Clean up temp file
  if (tempFilePath && fs.existsSync(tempFilePath)) {
    try {
      fs.unlinkSync(tempFilePath);
    } catch (error) {
      log("Error cleaning up temp file: " + error, true);
    }
    tempFilePath = undefined;
  }

  // Reset recording state and status bar
  isRecording = false;
  if (statusBarItem) {
    statusBarItem.text = "$(mic) Start Dictation";
  }
}

// Helper function to get the ffmpeg binary path
async function getFfmpegPath(): Promise<string> {
  const platform = os.platform();
  const binDir = path.join(extensionContext.extensionPath, "resources", "bin");
  const platformDir = path.join(binDir, platform);
  const ffmpegPath = path.join(platformDir, platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

  // Set executable permissions on Unix platforms
  if (platform !== "win32") {
    const permissionScript = path.join(platformDir, "set-permissions.sh");
    try {
      // Make the permission script executable
      await fs.promises.chmod(permissionScript, 0o755);
      // Run the permission script
      const process = spawn("/bin/bash", [permissionScript]);
      await new Promise<void>((resolve, reject) => {
        process.on("exit", (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Permission script failed with code ${code}`));
          }
        });
        process.on("error", reject);
      });
    } catch (error) {
      log(`Error setting FFmpeg permissions: ${error}`, true);
      throw error;
    }
  }

  log(`Platform: ${platform}`);
  log(`FFmpeg path: ${ffmpegPath}`);
  log(`Extension path: ${extensionContext.extensionPath}`);

  return ffmpegPath;
}

async function openSettings() {
  await vscode.commands.executeCommand("workbench.action.openSettings", "whisperdictation");
}

async function promptForApiKey() {
  const action = await vscode.window.showInformationMessage("OpenAI API key not configured. Please enter your API key.", "Enter API Key");

  if (action === "Enter API Key") {
    return updateApiKey();
  }
}

async function updateApiKey() {
  const apiKey = await vscode.window.showInputBox({
    prompt: "Enter your OpenAI API key",
    password: true,
    placeHolder: "sk-...",
  });

  if (apiKey) {
    await extensionContext.secrets.store(OPENAI_API_KEY_SECRET, apiKey);
    // Initialize OpenAI client with the new key
    openai = new OpenAI({ apiKey });
    vscode.window.showInformationMessage("API key saved securely");
    return true;
  }
  return false;
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

// Add activation logging
export async function activate(context: vscode.ExtensionContext) {
  try {
    // Create output channel first for logging
    outputChannel = vscode.window.createOutputChannel("WhisperDictation");
    log("Extension activation started.  Code version 2025-01-30.2");
    log(`Extension path: ${context.extensionPath}`);
    log(`OS platform: ${os.platform()}`);
    log(`OS release: ${os.release()}`);
    log(`Process versions: ${JSON.stringify(process.versions, null, 2)}`);

    // Store context
    extensionContext = context;

    // Try to initialize OpenAI client with existing API key
    const existingApiKey = await context.secrets.get(OPENAI_API_KEY_SECRET);
    if (existingApiKey) {
      log("Found existing API key, initializing OpenAI client");
      openai = new OpenAI({ apiKey: existingApiKey });
    } else {
      log("No API key found, will prompt user when needed");
    }

    // Initialize status bar
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(mic) Start Dictation";
    statusBarItem.command = "whisperdictation.startDictation";
    statusBarItem.show();
    log("Status bar initialized");

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand("whisperdictation.startDictation", async () => {
        log("Start dictation command triggered");
        if (!isRecording) {
          await startRecording();
        }
      }),
      vscode.commands.registerCommand("whisperdictation.stopDictation", async () => {
        log("Stop dictation command triggered");
        if (isRecording) {
          await stopRecording();
        }
      }),
      vscode.commands.registerCommand("whisperdictation.openSettings", async () => {
        log("Open settings command triggered");
        await openSettings();
      }),
      vscode.commands.registerCommand("whisperdictation.selectDevice", async () => {
        log("Select device command triggered");
        await promptForDeviceSelection();
      }),
      vscode.commands.registerCommand("whisperdictation.updateApiKey", async () => {
        log("Update API key command triggered");
        await updateApiKey();
      })
    );

    log("Commands registered");
    log("Extension activation completed successfully");
  } catch (error) {
    log(`Error during activation: ${error}`, true);
    throw error;
  }
}

async function startRecording() {
  try {
    // Only reset if we're already recording - handles edge cases
    if (isRecording) {
      log("Recording already in progress, stopping current recording first");
      await stopRecording();
    }

    // Get audio device first before creating temp file to minimize delay
    const deviceId = await selectAudioDevice();
    if (!deviceId) {
      throw new Error("No audio device selected");
    }

    // Create temp file path
    tempFilePath = path.join(os.tmpdir(), `dictation-${Date.now()}.webm`);
    log(`Temp file path: ${tempFilePath}`);

    // Get ffmpeg path
    const ffmpegPath = await getFfmpegPath();

    // Ensure ffmpeg exists
    if (!fs.existsSync(ffmpegPath)) {
      log(`FFmpeg not found at path: ${ffmpegPath}`, true);
      throw new Error(`FFmpeg not found at ${ffmpegPath}`);
    }

    // Build ffmpeg command with platform-specific settings
    const platform = os.platform();
    let inputFormat: string;
    let inputDevice: string;

    switch (platform) {
      case "win32":
        inputFormat = "dshow";
        inputDevice = `audio=${deviceId}`; // DirectShow format
        break;
      case "darwin":
        inputFormat = "avfoundation";
        inputDevice = `${deviceId}:`; // AVFoundation format (audio:video)
        break;
      case "linux":
        inputFormat = "alsa";
        inputDevice = deviceId; // ALSA device name
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    log(`Using audio input: format=${inputFormat}, device=${inputDevice}`);

    // Common FFmpeg arguments - add a small pre-recording buffer
    const args = [
      "-hide_banner",
      "-f",
      inputFormat,
      "-audio_buffer_size",
      "25", // Reduced buffer size for faster startup
      "-i",
      inputDevice,
      // Add auto-gain and volume normalization after input
      "-af",
      "volume=2.0,acompressor=threshold=-12dB:ratio=2:attack=200:release=1000",
      "-c:a",
      "libopus",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "20k",
      "-application",
      "voip",
      "-frame_duration",
      "20",
      "-packet_loss",
      "3",
      "-f",
      "webm",
      "-y",
      tempFilePath,
    ];

    // Platform-specific argument adjustments
    if (platform === "darwin") {
      args.splice(2, 0, "-channel_layout", "mono");
    }

    //log(`Starting FFmpeg with command: ${ffmpegPath} ${args.join(" ")}`);

    // Update status bar before starting recording to minimize perceived delay
    statusBarItem.text = "$(record) Recording... Click to Stop";
    statusBarItem.command = "whisperdictation.stopDictation";
    isRecording = true;

    // Start ffmpeg process
    recordingProcess = spawn(ffmpegPath, args);

    // Handle process events with better error reporting
    recordingProcess.stderr?.on("data", (data: Buffer) => {
      const message = data.toString().trim();
      // Only log actual errors or important messages
      if (
        message.toLowerCase().includes("error") ||
        message.includes("Could not") ||
        message.includes("Invalid") ||
        message.includes("No such")
      ) {
        log(`[FFmpeg Error] ${message}`, true);
        // Reset state if we detect a critical error, but not during initialization
        if (!message.includes("dummy") && (message.includes("Could not open") || message.includes("Cannot open"))) {
          resetRecordingState();
          vscode.window.showErrorMessage("Failed to access audio device. Please check your microphone settings.");
        }
      } else {
        //log(`[FFmpeg] ${message}`);
      }
    });

    // recordingProcess.stdout?.on("data", (data: Buffer) => {
    //   log(`[FFmpeg stdout] ${data.toString().trim()}`);
    // });

    recordingProcess.on("error", (err: Error) => {
      log(`FFmpeg process error: ${err.message}`, true);
      throw err;
    });

    recordingProcess.on("exit", (code: number | null, signal: string | null) => {
      if (code !== 0 && code !== null) {
        log(`FFmpeg process exited with error code: ${code}, signal: ${signal}`, true);
      } else {
        log(`FFmpeg process exited with code: ${code}, signal: ${signal}`);
      }
    });

    // Set up error handling for the process
    const processError = await new Promise<Error | null>((resolve) => {
      const spawnTimeout = setTimeout(() => {
        resolve(new Error("FFmpeg process failed to start within timeout"));
      }, 5000); // 5 second timeout for process to start

      recordingProcess?.on("error", (err) => {
        clearTimeout(spawnTimeout);
        resolve(err);
      });

      recordingProcess?.on("spawn", () => {
        clearTimeout(spawnTimeout);
        resolve(null);
      });
    });

    if (processError) {
      throw processError;
    }

    log("Recording started successfully");

    // Set up 30-minute timer to automatically stop recording
    recordingTimer = setTimeout(async () => {
      log("30-minute recording limit reached, stopping automatically");
      vscode.window.showInformationMessage("Recording stopped automatically after 30 minutes");
      await stopRecording();
    }, 30 * 60 * 1000); // 30 minutes in milliseconds
  } catch (error) {
    log(`Failed to start recording: ${error}`, true);
    resetRecordingState();
    throw error;
  }
}

async function stopRecording() {
  if (!isRecording || !recordingProcess || !tempFilePath) {
    log("Stop recording called but recording is not active");
    // Only reset if we're in an inconsistent state
    if (isRecording || recordingProcess || tempFilePath) {
      resetRecordingState();
    }
    return;
  }

  try {
    log("Stopping recording process...");
    // Stop recording gracefully
    recordingProcess.stdin?.write("q");

    // Wait for process to exit with better timeout handling
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        log("FFmpeg process timeout, killing forcefully");
        if (recordingProcess) {
          recordingProcess.kill("SIGKILL"); // Force kill on Windows
        }
        resolve();
      }, 2000); // Increased timeout to 2 seconds for slower systems

      recordingProcess?.on("exit", () => {
        log("FFmpeg process exited normally");
        clearTimeout(timeout);
        resolve();
      });

      recordingProcess?.on("error", (err) => {
        log(`Error during process exit: ${err}`, true);
        clearTimeout(timeout);
        resolve(); // Resolve anyway to continue cleanup
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
    statusBarItem.text = "$(mic) Start Dictation";
    statusBarItem.command = "whisperdictation.startDictation";

    // Check OpenAI client and API key before proceeding
    if (!openai) {
      log("OpenAI client not initialized, prompting for API key", true);
      const keyUpdated = await promptForApiKey();
      if (!keyUpdated) {
        throw new Error("OpenAI API key required for transcription");
      }
      // Verify the client was initialized after key update
      if (!openai) {
        throw new Error("Failed to initialize OpenAI client");
      }
    }

    // Create debug directory if it doesn't exist
    const debugDir = path.join(extensionContext.extensionPath, "DictationAudio");
    if (!fs.existsSync(debugDir)) {
      log(`Creating debug directory: ${debugDir}`);
      fs.mkdirSync(debugDir);
    }

    // Create debug file path
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const debugFilePath = path.join(debugDir, `dictation-${timestamp}.webm`);
    fs.copyFileSync(tempFilePath, debugFilePath);
    log(`Debug file copied successfully to: ${debugFilePath}`);

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

    // Call Whisper API with better error handling
    const config = vscode.workspace.getConfiguration("whisperdictation");
    try {
      log("Starting transcription with Whisper API...");
      const transcription = await openai.audio.transcriptions.create({
        file: audioStream,
        model: "whisper-1",
        language: config.get<string>("language") || "en",
        response_format: "text",
      });

      log("Transcription successful, length: " + transcription.length);

      // Copy to clipboard first
      await vscode.env.clipboard.writeText(transcription);

      // Try to detect the active editor's content before paste
      const editor = vscode.window.activeTextEditor;
      let beforeText = "";
      let beforePosition: vscode.Position | undefined;

      if (editor) {
        beforeText = editor.document.getText();
        beforePosition = editor.selection.active;
      }

      // Try clipboard paste first
      try {
        await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
      } catch (error) {
        // If paste command fails and we have an editor, try direct insertion
        if (editor) {
          await editor.edit((editBuilder) => {
            if (editor.selection.isEmpty) {
              editBuilder.insert(editor.selection.active, transcription);
            } else {
              editBuilder.replace(editor.selection, transcription);
            }
          });
          log("Inserted text using editor API after paste failed");
        } else {
          // Both methods failed, show clipboard message
          log(`Text insertion failed: ${error}`, true);
          vscode.window.showInformationMessage("Text copied to clipboard - press Ctrl+V/Cmd+V to paste");
        }
      }

      // Write transcription to debug file
      fs.writeFileSync(debugFilePath + ".txt", transcription);
    } catch (apiError) {
      // Check specifically for API key related errors
      const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
      log(`API Error: ${errorMessage}`, true);

      if (
        errorMessage.includes("401") ||
        errorMessage.toLowerCase().includes("api key") ||
        errorMessage.toLowerCase().includes("unauthorized") ||
        errorMessage.toLowerCase().includes("invalid")
      ) {
        log("API key validation failed, prompting for update", true);
        const response = await vscode.window.showErrorMessage(
          "Invalid or expired OpenAI API key. Please update your API key.",
          "Update API Key"
        );
        if (response === "Update API Key") {
          await updateApiKey();
        }
        return;
      }
      // Re-throw other API errors with more context
      throw new Error(`Whisper API error: ${errorMessage}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Transcription error: ${errorMessage}`, true);
    vscode.window.showErrorMessage(`Transcription failed: ${errorMessage}`);
  } finally {
    resetRecordingState();
  }
}

async function detectAudioDevices(): Promise<AudioDevice[]> {
  try {
    const ffmpegPath = await getFfmpegPath();
    if (!fs.existsSync(ffmpegPath)) {
      throw new Error(`FFmpeg not found at ${ffmpegPath}`);
    }

    log("Detecting audio devices...");
    const platform = os.platform();
    let args: string[];

    switch (platform) {
      case "win32":
        args = ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"];
        break;
      case "darwin":
        args = ["-hide_banner", "-f", "avfoundation", "-list_devices", "true", "-i", ""];
        break;
      case "linux":
        args = ["-hide_banner", "-f", "alsa", "-list_devices", "true", "-i", "dummy"];
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    const devices: AudioDevice[] = [];
    const process = spawn(ffmpegPath, args);
    let output = "";

    // Collect all output
    process.stderr?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    await new Promise<void>((resolve, reject) => {
      process.on("exit", (code) => {
        if (code !== 0 && code !== 255) {
          // FFmpeg returns 255 for help/list commands
          reject(new Error(`FFmpeg exited with code ${code}`));
        } else {
          resolve();
        }
      });
      process.on("error", reject);
    });

    // Parse devices based on platform
    switch (platform) {
      case "win32":
        // Windows DirectShow format
        const lines = output.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.includes("(audio)")) {
            const name = line.split('"')[1];
            const idLine = lines[i + 1]?.trim();
            if (idLine && idLine.includes("Alternative name")) {
              const id = idLine.split('"')[1];
              devices.push({ name, id });
            }
          }
        }
        break;

      case "darwin":
        // macOS AVFoundation format
        const audioDeviceRegex = /\[AVFoundation input device @ (.*?)\]\s+\[(\d+)\]\s+(.*)/g;
        let match;
        while ((match = audioDeviceRegex.exec(output)) !== null) {
          const id = match[2];
          const name = match[3].trim();
          devices.push({ name, id });
        }
        break;

      case "linux":
        // Linux ALSA format
        const alsaLines = output.split("\n");
        for (const line of alsaLines) {
          if (line.includes("*")) {
            // ALSA marks default device with *
            const name = line.trim().split("*")[1]?.trim();
            if (name) {
              // For ALSA, name is also the ID
              devices.push({ name, id: name });
            }
          }
        }
        break;
    }

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
  // Use the cached device if available
  if (currentAudioDevice) {
    return currentAudioDevice.id;
  }

  // If no cached device, update available devices
  availableDevices = await detectAudioDevices();

  if (availableDevices.length === 0) {
    throw new Error("No audio devices found");
  }

  // Get configured device name from settings
  const config = vscode.workspace.getConfiguration("whisperdictation");
  const configuredDeviceName = config.get<string>("audioDevice");

  // If a device name is configured, check if it's available
  if (configuredDeviceName) {
    const device = availableDevices.find((d) => d.name === configuredDeviceName);
    if (device) {
      currentAudioDevice = device;
      return device.id;
    }
  }

  // Use first available device
  currentAudioDevice = availableDevices[0];
  return currentAudioDevice.id;
}

async function promptForDeviceSelection(): Promise<void> {
  try {
    // Only reset if currently recording
    if (isRecording) {
      log("Recording in progress, stopping before device switch");
      await stopRecording();
    }

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
      detail: "Audio Input Device",
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Select audio input device",
      title: "Available Audio Devices",
    });

    if (selected) {
      // Save device name to settings and update current device
      const config = vscode.workspace.getConfiguration("whisperdictation");
      await config.update("audioDevice", selected.label, vscode.ConfigurationTarget.Global);
      currentAudioDevice = availableDevices.find((d) => d.name === selected.label);

      // Update status bar tooltip with current device
      statusBarItem.tooltip = `Current audio device: ${selected.label}`;

      vscode.window.showInformationMessage(`Audio device set to: ${selected.label}`);
      log(`Audio device configured: ${selected.label} (${selected.description})`);
    }
  } catch (error) {
    log(`Error selecting audio device: ${error}`, true);
    vscode.window.showErrorMessage(`Failed to select audio device: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Add a new function to initialize the audio device on startup
async function initializeAudioDevice(): Promise<void> {
  try {
    // Update available devices
    availableDevices = await detectAudioDevices();

    if (availableDevices.length === 0) {
      log("No audio devices found during initialization");
      return;
    }

    // Get configured device name from settings
    const config = vscode.workspace.getConfiguration("whisperdictation");
    const configuredDeviceName = config.get<string>("audioDevice");

    // Find the configured device or use the first available one
    currentAudioDevice = availableDevices.find((d) => d.name === configuredDeviceName) || availableDevices[0];

    // If no device is configured, set the first available one
    if (!configuredDeviceName) {
      await config.update("audioDevice", currentAudioDevice.name, vscode.ConfigurationTarget.Global);
      log(`Initialized default audio device: ${currentAudioDevice.name} (${currentAudioDevice.id})`);
    }

    // Update status bar tooltip with current device
    statusBarItem.tooltip = `Current audio device: ${currentAudioDevice.name}`;
  } catch (error) {
    log(`Error initializing audio device: ${error}`, true);
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

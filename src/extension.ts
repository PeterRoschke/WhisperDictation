/// <reference lib="dom" />

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import OpenAI from "openai";

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";

// Type definitions
interface AudioDevice {
  name: string;
  id: string;
  isDefault?: boolean;
}

// Recording states
enum RecordingState {
  Idle = "idle",
  Recording = "recording",
  Processing = "processing",
}

// Global state
let recordingProcess: ReturnType<typeof spawn> | undefined;
let statusBarItem: vscode.StatusBarItem;
let openai: OpenAI | undefined;
let outputChannel: vscode.OutputChannel;
let tempFilePath: string | undefined;
let extensionContext: vscode.ExtensionContext;
let recordingTimer: NodeJS.Timeout | undefined;
let currentAudioDevice: AudioDevice | undefined;
let availableDevices: AudioDevice[] = [];
let currentState: RecordingState = RecordingState.Idle;

const OPENAI_API_KEY_SECRET = "openai-key";
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB limit before compression
const MAX_FINAL_SIZE_BYTES = 25 * 1024 * 1024; // 25MB absolute limit for Whisper API

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

// Helper function to get SoX path
function getSoxPath(): string {
  const extensionPath = path.dirname(__dirname);
  const soxPath = path.join(extensionPath, "resources", "bin", "win32", "sox.exe");
  log(`SoX path: ${soxPath}`);
  return soxPath;
}

// Reset recording state
function resetRecordingState() {
  // Clear recording timer
  if (recordingTimer) {
    clearTimeout(recordingTimer);
    recordingTimer = undefined;
  }

  // Kill the recording process if it exists
  if (recordingProcess) {
    try {
      recordingProcess.kill();
    } catch (error) {
      log(`Error killing recording process: ${error}`, true);
    }
    recordingProcess = undefined;
  }

  // Clean up temp file
  if (tempFilePath && fs.existsSync(tempFilePath)) {
    try {
      fs.unlinkSync(tempFilePath);
    } catch (error) {
      log(`Error cleaning up temp file: ${error}`, true);
    }
    tempFilePath = undefined;
  }

  // Reset recording state and status bar
  currentState = RecordingState.Idle;
  updateStatusBarState();
}

// Update status bar based on current state
function updateStatusBarState() {
  if (!statusBarItem) return;

  switch (currentState) {
    case RecordingState.Idle:
      statusBarItem.text = "$(mic) Start Dictation";
      statusBarItem.command = "whisperdictation.startDictation";
      statusBarItem.tooltip = currentAudioDevice ? `Current audio device: ${currentAudioDevice.name}` : "No audio device selected";
      break;
    case RecordingState.Recording:
      statusBarItem.text = "$(record) Recording... Click to Stop";
      statusBarItem.command = "whisperdictation.stopDictation";
      statusBarItem.tooltip = currentAudioDevice ? `Recording from: ${currentAudioDevice.name}` : "Recording";
      break;
    case RecordingState.Processing:
      statusBarItem.text = "$(sync~spin) Processing...";
      statusBarItem.command = undefined;
      statusBarItem.tooltip = "Transcribing audio...";
      break;
  }
}

// Get debug directory based on OS
function getDebugDirectory(): string {
  const platform = os.platform();
  let basePath: string;

  switch (platform) {
    case "win32":
      basePath = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
      break;
    case "darwin":
      basePath = path.join(os.homedir(), "Library", "Application Support");
      break;
    default: // Linux and others
      basePath = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
      break;
  }

  return path.join(basePath, "WhisperDictation", "Debug");
}

async function startRecording(context: vscode.ExtensionContext): Promise<void> {
  try {
    // Create a temporary file for the recording
    tempFilePath = path.join(os.tmpdir(), `recording-${Date.now()}.wav`);
    log(`Recording to temporary file: ${tempFilePath}`);

    // Build the exact command we know works
    const soxPath = getSoxPath();

    // Format options must come before input/output files
    const args = [
      // Format options for input
      "-c",
      "1", // Mono channel
      "-r",
      "16000", // 16kHz sample rate (Whisper requirement)
      "-b",
      "16", // 16-bit depth
      "-e",
      "signed-integer",
      // Input specification
      "-t",
      "waveaudio",
      "default",
      // Buffer size (smaller for more frequent writes)
      "--buffer",
      "2048",
      // reduce logging to errors, supress audio meter
      "-V2",
      "-q",
      // Output format - WAV with minimal header
      "-t",
      "wav",

      // Output file
      tempFilePath.replace(/\\/g, "/"), // Convert Windows path separators
    ];

    log(`Spawning process with args: ${JSON.stringify(args, null, 2)}`);
    log(`Full command that would be executed: ${soxPath} ${args.join(" ")}`);

    // Spawn the recording process
    recordingProcess = spawn(soxPath, args, {
      windowsVerbatimArguments: true,
      env: {
        ...process.env,
        PATH: path.dirname(soxPath) + path.delimiter + process.env.PATH,
      },
    });

    if (!recordingProcess || !recordingProcess.stdout || !recordingProcess.stderr) {
      throw new Error("Failed to start recording process");
    }

    recordingProcess.stdout.on("data", (data) => {
      log(`Recording stdout: ${data}`);
    });

    recordingProcess.stderr.on("data", (data) => {
      log(`Recording stderr: ${data}`);
    });

    recordingProcess.on("error", (error) => {
      log(`Recording process error: ${error}`, true);
      if (error.stack) {
        log(`Error stack trace: ${error.stack}`, true);
      }
      stopRecording();
      vscode.window.showErrorMessage(`Recording error: ${error.message}`);
    });

    recordingProcess.on("close", (code, signal) => {
      log(`Recording process closed with code ${code} and signal ${signal}`);

      // Only handle transcription if we're not already processing
      // This prevents double transcription when stopping manually
      if (code !== 0 && signal !== "SIGTERM" && currentState === RecordingState.Recording) {
        log("Recording process closed unexpectedly", true);
        stopRecording();
        vscode.window.showErrorMessage("Recording stopped unexpectedly");
      }
    });

    // Update state
    currentState = RecordingState.Recording;
    updateStatusBarState();
    log("Recording started successfully");
  } catch (error) {
    log(`Error starting recording: ${error}`, true);
    if (error instanceof Error) {
      log(`Error stack trace: ${error.stack}`, true);
    }
    stopRecording();
    vscode.window.showErrorMessage("Failed to start recording. Please try again.");
  }
}

async function convertToOgg(inputPath: string): Promise<string> {
  const outputPath = inputPath.replace(/\.wav$/, ".ogg");
  const soxPath = getSoxPath();

  log(`Starting WAV to OGG conversion...`);
  const startTime = Date.now();

  return new Promise<string>((resolve, reject) => {
    const conversionProcess = spawn(soxPath, [
      inputPath,
      "-t",
      "ogg",
      // High quality compression
      "-C",
      "4",
      outputPath,
    ]);

    conversionProcess.stderr.on("data", (data) => {
      log(`Conversion stderr: ${data}`);
    });

    conversionProcess.on("close", (code) => {
      const endTime = Date.now();
      const duration = endTime - startTime;

      if (code === 0) {
        log(`Conversion completed in ${duration}ms`);
        resolve(outputPath);
      } else {
        log(`Conversion failed with code ${code}`, true);
        reject(new Error(`Conversion failed with code ${code}`));
      }
    });

    conversionProcess.on("error", (error) => {
      log(`Conversion process error: ${error}`, true);
      reject(error);
    });
  });
}

async function stopRecording() {
  try {
    log("Stopping recording process...");

    // Only proceed if we're actually recording
    if (currentState !== RecordingState.Recording) {
      log("Not currently recording, ignoring stop request");
      return;
    }

    // Set state to processing to prevent multiple transcription attempts
    currentState = RecordingState.Processing;
    updateStatusBarState();

    // Short wait to allow final buffer writes
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Send SIGTERM to the process
    log("Sending SIGTERM to recording process");
    if (recordingProcess) {
      recordingProcess.kill("SIGTERM");

      // Wait a short time for clean termination
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Force kill if still running
      if (!recordingProcess.killed) {
        log("Process still running, forcing termination");
        recordingProcess.kill();
      }
      recordingProcess = undefined;
    }

    // Check if we have a valid recording
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      const initialStats = fs.statSync(tempFilePath);
      log(`Initial WAV file size: ${initialStats.size} bytes`);

      let fileToTranscribe = tempFilePath;

      // Check if we need to convert to OGG
      if (initialStats.size > MAX_FILE_SIZE_BYTES) {
        log(`File size ${initialStats.size} bytes exceeds ${MAX_FILE_SIZE_BYTES} bytes, converting to OGG...`);
        try {
          const oggPath = await convertToOgg(tempFilePath);
          const oggStats = fs.statSync(oggPath);
          log(`Converted OGG file size: ${oggStats.size} bytes (${Math.round((oggStats.size / initialStats.size) * 100)}% of original)`);

          // Clean up the original WAV file
          fs.unlinkSync(tempFilePath);
          log("Original WAV file cleaned up");

          // Check if the OGG file is still too large
          if (oggStats.size > MAX_FINAL_SIZE_BYTES) {
            log("Converted file still exceeds maximum size limit", true);
            fs.unlinkSync(oggPath);
            vscode.window.showErrorMessage("Recording too large even after compression. Please try a shorter recording.");
            resetRecordingState();
            return;
          }

          fileToTranscribe = oggPath;
          tempFilePath = oggPath; // Update tempFilePath to point to OGG file
        } catch (error) {
          log(`Error during conversion: ${error}`, true);
          fs.unlinkSync(tempFilePath);
          vscode.window.showErrorMessage("Error converting audio file. Please try again.");
          resetRecordingState();
          return;
        }
      }

      if (fs.existsSync(fileToTranscribe)) {
        const finalStats = fs.statSync(fileToTranscribe);
        if (finalStats.size > 0) {
          log("Valid recording file found, proceeding with transcription");
          await transcribeRecording(fileToTranscribe, extensionContext);
        } else {
          log("Recording file is empty", true);
          fs.unlinkSync(fileToTranscribe);
          vscode.window.showErrorMessage("Recording failed - no audio data captured.");
          resetRecordingState();
        }
      } else {
        log("No recording file found", true);
        resetRecordingState();
      }
    } else {
      log("No recording file found", true);
      resetRecordingState();
    }
  } catch (error) {
    log(`Error stopping recording: ${error}`, true);
    resetRecordingState();
  }
}

async function transcribeRecording(filePath: string, context: vscode.ExtensionContext): Promise<void> {
  try {
    if (!fs.existsSync(filePath)) {
      log(`Recording file not found: ${filePath}`);
      vscode.window.showErrorMessage("Recording file not found.");
      resetRecordingState();
      return;
    }

    log("Processing recording...");
    currentState = RecordingState.Processing;
    updateStatusBarState();

    // Get the OpenAI API key from the extension's secrets
    const apiKey = await context.secrets.get(OPENAI_API_KEY_SECRET);
    if (!apiKey) {
      log("OpenAI API key not found");
      const keyUpdated = await promptForApiKey();
      if (!keyUpdated) {
        log("No API key provided by user");
        vscode.window.showErrorMessage('OpenAI API key not found. Please set it using the "Set OpenAI API Key" command.');
        resetRecordingState();
        return;
      }
    }

    // Get the language setting
    const language = vscode.workspace.getConfiguration("whisperdictation").get<string>("language") || "en";
    log(`Using language: ${language}`);

    // Create OpenAI client
    const openai = new OpenAI({ apiKey });
    log("OpenAI client initialized");

    // Get configuration for debug file saving
    const config = vscode.workspace.getConfiguration("whisperdictation");
    const shouldSaveDebug = config.get<boolean>("saveDebugFiles") || false;
    let debugFilePath: string | undefined;

    if (shouldSaveDebug) {
      // Create debug directory if it doesn't exist
      const debugDir = getDebugDirectory();
      if (!fs.existsSync(debugDir)) {
        log(`Creating debug directory: ${debugDir}`);
        fs.mkdirSync(debugDir, { recursive: true });
      }

      // Create debug file path with local timestamp
      const now = new Date();
      const timestamp = now.toLocaleString("sv").replace(/[\s:]/g, "-"); // Use Swedish locale for YYYY-MM-DD HH-mm-ss format
      const fileExt = path.extname(filePath); // Get the actual file extension (.wav or .ogg)
      debugFilePath = path.join(debugDir, `dictation-${timestamp}${fileExt}`);

      // Copy the final audio file (either WAV or OGG)
      fs.copyFileSync(filePath, debugFilePath);
      log(`Debug file copied to: ${debugFilePath}`);
    }

    // Read the audio file and check its size
    const stats = fs.statSync(filePath);
    log(`Audio file size before upload: ${stats.size} bytes`);
    const audioData = fs.createReadStream(filePath);
    log("Audio file stream created");

    log("Starting transcription request to OpenAI...");
    const transcription = await openai.audio.transcriptions.create({
      file: audioData,
      model: "whisper-1",
      language: language,
    });
    log("Transcription received from OpenAI");
    log(`Transcription length: ${transcription.text.length} characters`);

    // Copy to clipboard first
    await vscode.env.clipboard.writeText(transcription.text);
    log("Transcription copied to clipboard");

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
      log("Transcription inserted using clipboard paste");
    } catch (error) {
      log(`Clipboard paste failed: ${error}`, true);
      // If paste command fails and we have an editor, try direct insertion
      if (editor) {
        await editor.edit((editBuilder) => {
          if (editor.selection.isEmpty) {
            editBuilder.insert(editor.selection.active, transcription.text);
          } else {
            editBuilder.replace(editor.selection, transcription.text);
          }
        });
        log("Inserted text using editor API after paste failed");
      } else {
        // Both methods failed, show clipboard message
        log("No active editor and clipboard paste failed", true);
        vscode.window.showInformationMessage("Text copied to clipboard - press Ctrl+V/Cmd+V to paste");
      }
    }

    // Save transcription text if debug is enabled
    if (shouldSaveDebug && debugFilePath) {
      fs.writeFileSync(debugFilePath + ".txt", transcription.text);
      log("Transcription saved to debug file");
    }

    log("Transcription completed and inserted successfully");
  } catch (error) {
    log(`Error processing recording: ${error}`, true);
    if (error instanceof Error) {
      log(`Error stack trace: ${error.stack}`, true);
      // Check specifically for API key related errors
      const errorMessage = error.message;
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
      } else {
        vscode.window.showErrorMessage(`Failed to process recording: ${error.message}`);
      }
    } else {
      vscode.window.showErrorMessage("Failed to process recording. Please try again.");
    }
  } finally {
    // Clean up the temporary file
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        log("Temporary recording file deleted");
      }
    } catch (error) {
      log(`Error deleting temporary file: ${error}`, true);
    }

    resetRecordingState();
  }
}

async function detectAudioDevices(): Promise<AudioDevice[]> {
  try {
    log("Detecting audio devices...");
    const soxPath = getSoxPath();

    // Try to record a brief sample to verify device access
    const testProcess = spawn(soxPath, ["-t", "waveaudio", "default", "-n", "trim", "0", "0.1"]);

    await new Promise<void>((resolve, reject) => {
      testProcess.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Device test failed with code ${code}`));
        }
      });
    });

    // If we get here, the default device works
    const defaultDevice = {
      id: "default",
      name: "System Default Input",
      isDefault: true,
    };

    log(`Found working default audio device: ${defaultDevice.name}`);
    return [defaultDevice];
  } catch (error) {
    log(`Failed to detect audio devices: ${error}`, true);
    if (error instanceof Error) {
      log(`Error stack trace: ${error.stack}`, true);
    }
    throw error;
  }
}

async function checkMicrophoneAccess(): Promise<boolean> {
  try {
    log("Checking microphone access...");
    const soxPath = getSoxPath();

    // Try to record a brief sample using the default device
    const process = spawn(soxPath, ["-t", "waveaudio", "-d", "-n", "trim", "0", "0.1"]);
    let output = "";

    return new Promise<boolean>((resolve) => {
      process.stdout.on("data", (data) => {
        output += data.toString();
        log(`Mic test stdout: ${data.toString()}`);
      });

      process.stderr.on("data", (data) => {
        output += data.toString();
        log(`Mic test stderr: ${data.toString()}`);

        // Check for specific error messages
        const errorText = data.toString().toLowerCase();
        if (errorText.includes("permission denied") || errorText.includes("access denied") || errorText.includes("cannot open device")) {
          log("Microphone access denied", true);
          resolve(false);
        }
      });

      process.on("error", (error) => {
        log(`Mic test process error: ${error}`, true);
        resolve(false);
      });

      process.on("close", (code) => {
        log(`Mic test process exited with code ${code}`);
        // Code 0 means success, code 1 might be ok in some cases
        if (code === 0) {
          log("Microphone access test successful");
          resolve(true);
        } else {
          log(`Mic test failed with code ${code}: ${output}`, true);
          resolve(false);
        }
      });
    });
  } catch (error) {
    log(`Error checking microphone access: ${error}`, true);
    if (error instanceof Error) {
      log(`Error stack trace: ${error.stack}`, true);
    }
    return false;
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
    if (recordingProcess) {
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

// Update the activation function to properly handle OpenAI API key
export async function activate(context: vscode.ExtensionContext) {
  try {
    // Create output channel first for logging
    outputChannel = vscode.window.createOutputChannel("WhisperDictation");

    log("Extension activation started. Code version 2025-01-31.3");
    log(`Extension path: ${context.extensionPath}`);
    log(`OS platform: ${os.platform()}`);
    log(`OS release: ${os.release()}`);
    log(`Process versions: ${JSON.stringify(process.versions, null, 2)}`);

    // Store context
    extensionContext = context;

    // Check for SoX
    try {
      log("Checking SoX installation...");
      const soxPath = getSoxPath();
      if (!fs.existsSync(soxPath)) {
        throw new Error(`SoX not found at path: ${soxPath}`);
      }
      log(`Found SoX at: ${soxPath}`);
    } catch (error) {
      log(`SoX check failed: ${error}`, true);
      vscode.window.showErrorMessage("WhisperDictation requires SoX for audio recording. Please reinstall the extension.");
      throw error;
    }

    // Initialize audio device early
    log("Pre-initializing audio devices...");
    const initResult = await initializeAudioDevice();
    if (!initResult) {
      log("Audio device initialization failed", true);
      vscode.window.showErrorMessage("Failed to initialize audio device. Some features may not work correctly.");
    } else {
      log("Audio device initialization successful");
    }

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
    updateStatusBarState();
    statusBarItem.show();
    log("Status bar initialized");

    // Register commands
    context.subscriptions.push(
      vscode.commands.registerCommand("whisperdictation.startDictation", async () => {
        log("Start dictation command triggered");
        if (currentState === RecordingState.Idle) {
          await startRecording(context);
        }
      }),
      vscode.commands.registerCommand("whisperdictation.stopDictation", async () => {
        log("Stop dictation command triggered");
        if (currentState === RecordingState.Recording) {
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
    if (error instanceof Error) {
      log(`Error stack trace: ${error.stack}`, true);
    }
    throw error;
  }
}

async function initializeAudioDevice(): Promise<boolean> {
  try {
    log("Starting audio device initialization...");

    // Check microphone access first
    const hasAccess = await checkMicrophoneAccess();
    if (!hasAccess) {
      vscode.window.showErrorMessage("WhisperDictation requires microphone access. Please check your system permissions and try again.");
      return false;
    }

    // First, detect available devices
    availableDevices = await detectAudioDevices();
    if (availableDevices.length === 0) {
      log("No audio devices found", true);
      return false;
    }

    // Get configured device from settings
    const config = vscode.workspace.getConfiguration("whisperdictation");
    const configuredDeviceName = config.get<string>("audioDevice");

    // Find configured device or use first available
    currentAudioDevice = configuredDeviceName ? availableDevices.find((d) => d.name === configuredDeviceName) : availableDevices[0];

    if (!currentAudioDevice) {
      currentAudioDevice = availableDevices[0];
      // Save the default device to settings
      await config.update("audioDevice", currentAudioDevice.name, vscode.ConfigurationTarget.Global);
      log(`Set default audio device to: ${currentAudioDevice.name}`);
    }

    const soxPath = getSoxPath();
    if (!fs.existsSync(soxPath)) {
      log(`SoX not found at path: ${soxPath}`, true);
      return false;
    }
    log(`Found SoX at: ${soxPath}`);

    log("Audio device initialization completed successfully");
    return true;
  } catch (error) {
    log(`Failed to initialize audio device: ${error}`, true);
    if (error instanceof Error) {
      log(`Error stack trace: ${error.stack}`, true);
    }
    return false;
  }
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

// This method is called when your extension is deactivated
export function deactivate() {
  if (recordingProcess) {
    recordingProcess.kill();
  }
  recordingProcess = undefined;
  openai = undefined;
}

/// <reference lib="dom" />

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import OpenAI from "openai";

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";

// Build time is injected by webpack
declare const BUILD_TIME: string;

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

// Dictation modes
enum DictationMode {
  Normal = "normal",
  ClipboardOnly = "clipboard-only",
}

// Global state
let recordingProcess: ReturnType<typeof spawn> | undefined;
let statusBarItem: vscode.StatusBarItem;
let openai: OpenAI | undefined;
let outputChannel: vscode.OutputChannel;
let tempFilePath: string | undefined;
let extensionContext: vscode.ExtensionContext;
let recordingTimer: NodeJS.Timeout | undefined;
let currentState: RecordingState = RecordingState.Idle;
let currentDictationMode: DictationMode = DictationMode.Normal;

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

// Helper function to detect Apple Silicon
function isAppleSilicon(): boolean {
  return os.platform() === "darwin" && process.arch === "arm64";
}

// Helper function to show platform-specific SoX error
async function showSoxError(error: Error): Promise<void> {
  const platform = os.platform();
  let message: string;
  let action: string | undefined;

  switch (platform) {
    case "win32":
      message = "Error accessing SoX. The extension may need to be reinstalled.";
      action = "Reinstall Extension";
      break;
    case "darwin":
      if (isAppleSilicon()) {
        message = "On Apple Silicon Macs, SoX needs to be installed via Homebrew. Run: brew install sox";
        action = "View Instructions";
      } else {
        message = "Error accessing SoX. The extension may need to be reinstalled or permissions need to be granted.";
        action = "Reinstall Extension";
      }
      break;
    case "linux":
      message = "Error accessing SoX. Please run the setup script to install SoX and configure permissions.";
      action = "View Setup Instructions";
      break;
    default:
      message = `Platform ${platform} is not supported.`;
      return;
  }

  const selected = await vscode.window.showErrorMessage(message, action);

  if (selected === "View Instructions" || selected === "View Setup Instructions") {
    const extensionPath = path.dirname(__dirname);
    const instructionsPath = path.join(extensionPath, "resources", "bin", "linux", "INSTALL.txt");

    if (fs.existsSync(instructionsPath)) {
      const doc = await vscode.workspace.openTextDocument(instructionsPath);
      await vscode.window.showTextDocument(doc);
    }
  } else if (selected === "Reinstall Extension") {
    await vscode.commands.executeCommand("workbench.extensions.action.showExtensionsWithIds", ["whisperdictation"]);
  }
}

// Helper function to verify SoX installation
async function verifySoxInstallation(): Promise<boolean> {
  try {
    const soxPath = getSoxPath();
    log(`Verifying SoX at path: ${soxPath}`);

    // For Linux, first check if sox is in PATH
    if (os.platform() === "linux" && soxPath === "sox") {
      const checkResult = await new Promise<boolean>((resolve) => {
        const process = spawn("which", ["sox"]);
        process.on("close", (code) => resolve(code === 0));
      });

      if (!checkResult) {
        log("SoX not found in PATH on Linux", true);
        await showSoxError(new Error("SoX not found in PATH"));
        return false;
      }
    } else if (!fs.existsSync(soxPath)) {
      // For Windows and macOS, check if the bundled binary exists
      log(`SoX binary not found at ${soxPath}`, true);
      await showSoxError(new Error("SoX binary not found"));
      return false;
    }

    // Test SoX functionality
    const result = await new Promise<boolean>((resolve) => {
      const process = spawn(soxPath, ["--version"]);
      let output = "";

      process.stdout.on("data", (data) => {
        output += data.toString();
      });

      process.stderr.on("data", (data) => {
        output += data.toString();
      });

      process.on("close", (code) => {
        if (code === 0) {
          log(`SoX version check successful: ${output.trim()}`);
          resolve(true);
        } else {
          log(`SoX version check failed with code ${code}: ${output}`, true);
          resolve(false);
        }
      });

      process.on("error", (err) => {
        log(`Error running SoX: ${err}`, true);
        resolve(false);
      });
    });

    if (!result) {
      await showSoxError(new Error("SoX verification failed"));
    }

    return result;
  } catch (error) {
    log(`Error verifying SoX: ${error}`, true);
    await showSoxError(error instanceof Error ? error : new Error(String(error)));
    return false;
  }
}

// Helper function to get SoX path
function getSoxPath(): string {
  const platform = os.platform();
  const extensionPath = path.dirname(__dirname);

  switch (platform) {
    case "win32":
      return path.join(extensionPath, "resources", "bin", "win32", "sox.exe");
    case "darwin":
      // For Apple Silicon, use system-installed SoX
      if (isAppleSilicon()) {
        return "sox"; // Use PATH-based SoX
      }
      return path.join(extensionPath, "resources", "bin", "darwin", "sox");
    case "linux":
      return "/usr/bin/sox"; // Use full path to system-installed SoX
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
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
  resetDictationMode();
}

// Update status bar based on current state
function updateStatusBarState() {
  if (!statusBarItem) return;

  switch (currentState) {
    case RecordingState.Idle:
      statusBarItem.text = "$(mic) Start Dictation";
      statusBarItem.command = "whisperdictation.startDictation";
      statusBarItem.tooltip = "Start recording using system default microphone";
      break;
    case RecordingState.Recording:
      statusBarItem.text = "$(record) Recording... Click to Stop";
      statusBarItem.command = "whisperdictation.stopDictation";
      statusBarItem.tooltip = "Recording in progress";
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

// Update the startRecording function to verify SoX first
async function startRecording(context: vscode.ExtensionContext): Promise<void> {
  try {
    // Verify SoX installation first
    if (!(await verifySoxInstallation())) {
      return;
    }

    // Create a temporary file for the recording
    tempFilePath = path.join(os.tmpdir(), `recording-${Date.now()}.wav`);
    log(`Recording to temporary file: ${tempFilePath}`);

    // Build the exact command we know works
    const soxPath = getSoxPath();
    const platform = os.platform();

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
    ];
    
    // Platform-specific input type
    if (platform === "win32") {
      args.push("waveaudio");
      args.push("default");
    } else if (platform === "darwin") {
      args.push("coreaudio");
      args.push("default");
    } else if (platform === "linux") {
      // On Linux, use alsa which is the standard audio driver
      args.push("alsa");
      args.push("default");
    }
    
    // Add the rest of the arguments
    args.push(
      // Buffer size (smaller for more frequent writes)
      "--buffer",
      "1024",
      // reduce logging to errors, supress audio meter
      "-V2",
      "-q",
      // Output format - WAV with minimal header
      "-t",
      "wav",
      // Output file
      tempFilePath.replace(/\\/g, "/"), // Convert Windows path separators
    );

    //log(`Spawning process with args: ${JSON.stringify(args, null, 2)}`);
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

    // Copy to clipboard
    await vscode.env.clipboard.writeText(transcription.text);
    log("Transcription copied to clipboard");

    // Only proceed with pasting if we're in normal mode
    if (currentDictationMode === DictationMode.Normal) {
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
    } else {
      // In clipboard-only mode, just show a notification
      vscode.window.showInformationMessage("Dictation copied to clipboard");
      log("Dictation copied to clipboard (clipboard-only mode)");
    }

    // Save transcription text if debug is enabled
    if (shouldSaveDebug && debugFilePath) {
      fs.writeFileSync(debugFilePath.replace(/\.(wav|ogg)$/, "") + ".txt", transcription.text);
      log("Transcription saved to debug file");
    }

    log("Transcription completed successfully");
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

// Update the activation function
export async function activate(context: vscode.ExtensionContext) {
  try {
    // Create output channel first for logging
    outputChannel = vscode.window.createOutputChannel("WhisperDictation");

    log("Extension activation started");
    log(`Build time: ${BUILD_TIME}`);
    log(`Extension path: ${context.extensionPath}`);
    log(`OS platform: ${os.platform()}`);
    log(`OS release: ${os.release()}`);
    log(`OS architecture: ${process.arch}`);
    log(`Process versions: ${JSON.stringify(process.versions, null, 2)}`);

    // Show warning for Apple Silicon Macs
    if (isAppleSilicon()) {
      log("Detected Apple Silicon Mac");
      const message = "On Apple Silicon Macs, SoX needs to be installed via Homebrew. Run: brew install sox";
      vscode.window.showInformationMessage(message);
    }

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

    // Check microphone access
    const hasAccess = await checkMicrophoneAccess();
    if (!hasAccess) {
      log("Microphone access check failed", true);
      vscode.window.showErrorMessage("WhisperDictation requires microphone access. Please check your system permissions and try again.");
      return;
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
      vscode.commands.registerCommand("whisperdictation.updateApiKey", async () => {
        log("Update API key command triggered");
        await updateApiKey();
      }),
      vscode.commands.registerCommand("whisperdictation.toggleDictation", async () => {
        log("Toggle dictation command triggered");
        if (currentState === RecordingState.Idle) {
          // Start recording in clipboard-only mode
          currentDictationMode = DictationMode.ClipboardOnly;
          log("Starting recording in clipboard-only mode");
          await startRecording(context);
        } else if (currentState === RecordingState.Recording) {
          // Stop recording
          log("Stopping recording from toggle command");
          await stopRecording();
        }
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

// Add after the resetRecordingState function
function resetDictationMode() {
  currentDictationMode = DictationMode.Normal;
  log("Reset dictation mode to normal");
}

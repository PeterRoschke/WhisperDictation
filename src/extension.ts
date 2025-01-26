/// <reference lib="dom" />

// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import OpenAI from "openai";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Readable } from "stream";

let isRecording = false;
let recordingProcess: any;
let audioChunks: Buffer[] = [];
let statusBarItem: vscode.StatusBarItem;
let openai: OpenAI | undefined;
let outputChannel: vscode.OutputChannel;
let selectedDevice: string | undefined;

interface RecordingError extends Error {
  message: string;
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

// Pre-initialize FFmpeg process
async function initializeFFmpeg() {
  try {
    // List devices
    const ffmpegArgs = ["-hide_banner", "-loglevel", "info", "-f", "dshow", "-list_devices", "true", "-i", "dummy"];
    const listDevicesProcess = spawn("ffmpeg", ffmpegArgs);
    let deviceList = "";

    listDevicesProcess.stderr.on("data", (data: Buffer) => {
      deviceList += data.toString();
      log(`[FFmpeg Devices] ${data.toString()}`);
    });

    await new Promise((resolve, reject) => {
      listDevicesProcess.on("exit", (code: number) => {
        log(`Device listing process exited with code: ${code}`);
        resolve(code);
      });
      listDevicesProcess.on("error", reject);
    });

    // Parse device list
    const audioDevices = deviceList
      .split("\n")
      .filter((line) => line.includes("(audio)"))
      .map((line) => {
        const match = line.match(/"([^"]+)"/);
        return match ? match[1] : undefined;
      })
      .filter((device): device is string => device !== undefined);

    if (audioDevices.length === 0) {
      throw new Error("No audio devices found");
    }

    log("Available audio devices: " + JSON.stringify(audioDevices));
    selectedDevice = audioDevices[0];
    log("Selected audio device: " + selectedDevice);

    return true;
  } catch (error) {
    log(`FFmpeg initialization error: ${error}`, true);
    return false;
  }
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Create output channel
  outputChannel = vscode.window.createOutputChannel("WhisperDictation");
  context.subscriptions.push(outputChannel);

  log("Extension activation started");
  log("Extension path: " + context.extensionPath);

  try {
    // Initialize FFmpeg during activation
    initializeFFmpeg().then((initialized) => {
      if (initialized) {
        log("FFmpeg pre-initialized successfully");
      } else {
        log("FFmpeg pre-initialization failed, will retry on first use", true);
      }
    });

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

        // Initialize FFmpeg if needed
        if (!selectedDevice) {
          const initialized = await initializeFFmpeg();
          if (!initialized) {
            throw new Error("Failed to initialize audio device");
          }
        }

        // Clear previous chunks
        audioChunks = [];

        // Start recording with pre-initialized device
        const recordArgs = [
          "-hide_banner",
          "-loglevel",
          "info",
          "-f",
          "dshow",
          "-audio_buffer_size",
          "5",
          "-thread_queue_size",
          "1024",
          "-i",
          `audio=${selectedDevice}`,
          "-c:a",
          "libopus",
          "-b:a",
          "24k",
          "-ar",
          "16000",
          "-ac",
          "1",
          "-f",
          "webm",
          "-flush_packets",
          "1",
          "-y",
          "pipe:1",
        ];

        log("Starting recording with args: " + JSON.stringify(recordArgs));
        recordingProcess = spawn("ffmpeg", recordArgs);
        let stderrOutput = "";

        recordingProcess.stdout.on("data", (data: Buffer) => {
          //log(`Received audio chunk of size: ${data.length}`);
          audioChunks.push(data);
        });

        recordingProcess.stderr.on("data", (data: Buffer) => {
          stderrOutput += data.toString();
          log(`[FFmpeg] ${data.toString()}`);
        });

        recordingProcess.on("error", (err: Error) => {
          log(`FFmpeg error: ${err.message}`, true);
          log(`FFmpeg stderr output: ${stderrOutput}`, true);
          throw new Error(`Failed to start recording: ${err.message}`);
        });

        recordingProcess.on("exit", (code: number) => {
          log(`FFmpeg process exited with code: ${code}`);
          if (code !== 0) {
            log(`FFmpeg stderr output: ${stderrOutput}`, true);
          }
        });

        isRecording = true;
        statusBarItem.text = "$(record) Recording... Click to Stop";
        vscode.window.showInformationMessage("Recording started! Press Ctrl+Insert or click the status bar icon to stop.");
      } catch (error) {
        console.error("[WhisperDictation] Recording error:", error);
        vscode.window.showErrorMessage(`Failed to start recording: ${error instanceof Error ? error.message : String(error)}`);
        isRecording = false;
        statusBarItem.text = "$(unmute) Start Dictation";
      }
    });

    let stopDictationCmd = vscode.commands.registerCommand("whipserdictation.stopDictation", stopRecording);

    context.subscriptions.push(startDictationCmd);
    context.subscriptions.push(stopDictationCmd);

    // Verify command registration
    vscode.commands.getCommands(true).then((commands) => {
      console.log("[WhisperDictation] All registered commands after activation:", commands);
      console.log("[WhisperDictation] Checking if our commands are registered:");
      console.log("startDictation registered:", commands.includes("whipserdictation.startDictation"));
      console.log("stopDictation registered:", commands.includes("whipserdictation.stopDictation"));
    });

    log("Extension successfully activated");
  } catch (error) {
    log("Activation error: " + (error instanceof Error ? error.message : String(error)), true);
    throw error; // Re-throw to ensure VS Code sees the activation failure
  }
}

async function stopRecording() {
  if (!isRecording || !recordingProcess) {
    return;
  }

  let tempFilePath: string | undefined;
  let debugFilePath: string | undefined;

  try {
    // Signal FFmpeg to stop gracefully by sending 'q' command
    recordingProcess.stdin.write("q");

    // Wait for FFmpeg to flush its buffers and exit gracefully
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        recordingProcess.kill();
        resolve();
      }, 1000); // Fallback timeout of 1 second

      recordingProcess.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    isRecording = false;
    statusBarItem.text = "$(unmute) Start Dictation";

    // Wait a bit longer for any remaining data in the pipe
    await new Promise((resolve) => setTimeout(resolve, 200));

    if (!openai) {
      throw new Error("OpenAI client not initialized");
    }

    // Create debug directory if it doesn't exist
    const debugDir = path.join(vscode.workspace.workspaceFolders?.[0].uri.fsPath || "", "DictationAudio");
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir);
    }

    // Create both temp and debug files
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    tempFilePath = path.join(os.tmpdir(), `dictation-${Date.now()}.webm`);
    debugFilePath = path.join(debugDir, `dictation-${timestamp}.webm`);

    // Combine audio chunks and write directly to files
    const audioBuffer = Buffer.concat(audioChunks);
    console.log("[WhisperDictation] Total audio chunks:", audioChunks.length);
    console.log("[WhisperDictation] Combined buffer size:", audioBuffer.length);

    if (audioBuffer.length === 0) {
      throw new Error("No audio data was captured");
    }

    // Write files directly (WebM already has proper container format)
    fs.writeFileSync(tempFilePath, audioBuffer);
    fs.writeFileSync(debugFilePath, audioBuffer);

    // Log file details with more information
    log(
      "Audio file details: " +
        JSON.stringify(
          {
            tempPath: tempFilePath,
            debugPath: debugFilePath,
            sizeInMB: (audioBuffer.length / (1024 * 1024)).toFixed(2) + " MB",
            format: "WebM/Opus",
            sampleRate: "16000 Hz",
            channels: "1 (mono)",
            bitrate: "24 kbps",
          },
          null,
          2
        )
    );

    // Call Whisper API
    const config = vscode.workspace.getConfiguration("whipserdictation");
    log(
      "Calling Whisper API with config: " +
        JSON.stringify(
          {
            model: "whisper-1",
            language: config.get<string>("language") || "en",
            response_format: "text",
            fileSize: audioBuffer.length,
          },
          null,
          2
        )
    );

    // Create a readable stream from the temp file
    const audioStream = fs.createReadStream(tempFilePath);

    // Log stream details
    audioStream.on("open", () => {
      log("Audio stream opened");
    });

    audioStream.on("error", (err) => {
      log(`Audio stream error: ${err}`, true);
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioStream,
      model: "whisper-1",
      language: config.get<string>("language") || "en",
      response_format: "text",
    });

    console.log("[WhisperDictation] Transcription successful, length:", transcription.length);

    // Insert text
    try {
      // First, copy to clipboard as backup
      await vscode.env.clipboard.writeText(transcription);
      let inserted = false;

      // 3. Try generic paste command
      if (!inserted) {
        try {
          await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
          inserted = true;
          log("Inserted text using paste command");
        } catch (e) {
          log(`Paste command failed: ${e}`, true);
          vscode.window.showInformationMessage("Text copied to clipboard - press Ctrl+V/Cmd+V to paste");
          log("Defaulted to clipboard with user notification");
        }
      }
    } catch (insertError) {
      log(`Text insertion failed: ${insertError}`, true);
      vscode.window.showInformationMessage("Text copied to clipboard - press Ctrl+V/Cmd+V to paste");
    }

    // Write transcription to debug file
    fs.writeFileSync(debugFilePath + ".txt", transcription);

    vscode.window.showInformationMessage("Transcription complete!");
  } catch (error) {
    log("Transcription error: " + (error instanceof Error ? error.message : String(error)), true);
    if (error instanceof Error) {
      log(
        "Error details: " +
          JSON.stringify(
            {
              name: error.name,
              message: error.message,
              stack: error.stack,
            },
            null,
            2
          ),
        true
      );
    }
    vscode.window.showErrorMessage(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Clean up temp file but keep debug file for inspection
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (error) {
        console.error("Failed to clean up temp file:", error);
      }
    }
    // Clear the audio chunks
    audioChunks = [];
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  if (isRecording && recordingProcess) {
    recordingProcess.kill();
  }
  // Clear the audio chunks
  audioChunks = [];
  // Clear the OpenAI client
  openai = undefined;
}

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

function getWebviewContent() {
  return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" 
                content="default-src 'none'; 
                        script-src 'unsafe-inline' 'unsafe-eval'; 
                        style-src 'unsafe-inline';
                        media-src mediastream: blob: https: *;
                        connect-src mediastream: blob: https: *">
            <title>Whisper Dictation</title>
            <style>
                body {
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    font-family: var(--vscode-font-family);
                }
                .container {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 20px;
                }
                .status {
                    font-size: 1.2em;
                    margin-bottom: 10px;
                    text-align: center;
                }
                .visualizer {
                    width: 100%;
                    height: 100px;
                    background: var(--vscode-editor-background);
                    border: 1px solid var(--vscode-panel-border);
                }
                .time {
                    font-family: monospace;
                    font-size: 1.5em;
                }
                .error {
                    color: var(--vscode-errorForeground);
                    margin: 10px 0;
                    text-align: center;
                }
                .button {
                    padding: 8px 16px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 14px;
                }
                .button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="status">Click "Start Recording" to begin</div>
                <canvas class="visualizer"></canvas>
                <div class="time">00:00</div>
                <button id="startButton" class="button">Start Recording</button>
                <button id="retryButton" class="button" style="display: none;">Retry Microphone Access</button>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                
                // Initialize UI elements
                const statusElement = document.querySelector('.status');
                const startButton = document.querySelector('#startButton');
                const retryButton = document.querySelector('#retryButton');
                const visualizer = document.querySelector('.visualizer');
                const timeDisplay = document.querySelector('.time');

                // Initialize variables
                let audioContext;
                let startTime;
                let animationFrame;

                async function startRecording() {
                    try {
                        statusElement.textContent = 'Requesting microphone access...';
                        startButton.style.display = 'none';
                        retryButton.style.display = 'none';

                        // Check if we're in a secure context
                        console.log('Checking secure context:', window.isSecureContext);
                        if (!window.isSecureContext) {
                            throw new Error('MediaRecorder requires a secure context (HTTPS or localhost)');
                        }

                        // Check if MediaDevices API is available
                        console.log('Checking MediaDevices API:', !!navigator.mediaDevices);
                        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                            throw new Error('MediaDevices API not available in this environment');
                        }

                        console.log('Checking microphone permissions...');
                        // First check if we have permissions
                        if (navigator.permissions && navigator.permissions.query) {
                            try {
                                const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
                                console.log('Permission query result:', {
                                    state: permissionStatus.state,
                                    name: 'microphone'
                                });
                                
                                permissionStatus.onchange = () => {
                                    console.log('Permission status changed:', permissionStatus.state);
                                };
                                
                                if (permissionStatus.state === 'denied') {
                                    throw new Error('Microphone access is blocked. Please check your browser settings.');
                                }
                            } catch (permError) {
                                console.error('Error querying permissions:', permError);
                                throw permError;
                            }
                        } else {
                            console.log('Permissions API not available, proceeding with getUserMedia directly');
                        }

                        console.log('Requesting getUserMedia...');
                        const stream = await navigator.mediaDevices.getUserMedia({
                            audio: {
                                channelCount: 1,
                                sampleRate: 16000,
                                echoCancellation: true,
                                noiseSuppression: true
                            }
                        });

                        statusElement.textContent = 'Recording... Press Ctrl+Insert to stop';

                        // Set up audio context and analyzer
                        audioContext = new AudioContext();
                        const source = audioContext.createMediaStreamSource(stream);
                        const analyzer = audioContext.createAnalyser();
                        analyzer.fftSize = 2048;
                        source.connect(analyzer);

                        // Set up visualizer
                        const canvasCtx = visualizer.getContext('2d');
                        const bufferLength = analyzer.frequencyBinCount;
                        const dataArray = new Uint8Array(bufferLength);

                        function drawVisualizer() {
                            const width = visualizer.width;
                            const height = visualizer.height;
                            
                            analyzer.getByteTimeDomainData(dataArray);
                            canvasCtx.fillStyle = 'var(--vscode-editor-background)';
                            canvasCtx.fillRect(0, 0, width, height);
                            canvasCtx.lineWidth = 2;
                            canvasCtx.strokeStyle = 'var(--vscode-textLink-foreground)';
                            canvasCtx.beginPath();

                            const sliceWidth = width / bufferLength;
                            let x = 0;

                            for (let i = 0; i < bufferLength; i++) {
                                const v = dataArray[i] / 128.0;
                                const y = v * height / 2;

                                if (i === 0) {
                                    canvasCtx.moveTo(x, y);
                                } else {
                                    canvasCtx.lineTo(x, y);
                                }

                                x += sliceWidth;
                            }

                            canvasCtx.lineTo(width, height / 2);
                            canvasCtx.stroke();
                            animationFrame = requestAnimationFrame(drawVisualizer);
                        }

                        // Start recording
                        mediaRecorder = new MediaRecorder(stream, {
                            mimeType: 'audio/webm'
                        });

                        mediaRecorder.ondataavailable = (event) => {
                            audioChunks.push(event.data);
                        };

                        mediaRecorder.onstop = () => {
                            const blob = new Blob(audioChunks, { type: 'audio/webm' });
                            vscode.postMessage({ 
                                type: 'audioData',
                                data: blob
                            });
                            stream.getTracks().forEach(track => track.stop());
                            if (animationFrame) {
                                cancelAnimationFrame(animationFrame);
                            }
                        };

                        // Start recording and visualization
                        mediaRecorder.start(1000);
                        startTime = Date.now();
                        updateTimer();
                        drawVisualizer();

                    } catch (error) {
                        console.error('Recording error:', error);
                        let errorMessage = error.message;
                        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
                            errorMessage = 'Microphone access was denied. Please allow access and try again.';
                        }
                        statusElement.textContent = errorMessage;
                        startButton.style.display = 'none';
                        retryButton.style.display = 'block';
                        vscode.postMessage({ 
                            type: 'error',
                            message: errorMessage
                        });
                    }
                }

                // Update timer
                function updateTimer() {
                    if (!startTime) return;
                    const elapsed = Math.floor((Date.now() - startTime) / 1000);
                    const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
                    const seconds = (elapsed % 60).toString().padStart(2, '0');
                    timeDisplay.textContent = \`\${minutes}:\${seconds}\`;
                    requestAnimationFrame(updateTimer);
                }

                // Handle button clicks
                startButton.addEventListener('click', startRecording);
                retryButton.addEventListener('click', startRecording);

                // Handle messages from the extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    switch (message.type) {
                        case 'stop':
                            if (mediaRecorder && mediaRecorder.state === 'recording') {
                                mediaRecorder.stop();
                                statusElement.textContent = 'Processing...';
                            }
                            break;
                    }
                });
            </script>
        </body>
        </html>
    `;
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
          "10",
          "-thread_queue_size",
          "1024",
          "-i",
          `audio=${selectedDevice}`,
          "-acodec",
          "pcm_s16le",
          "-ar",
          "16000",
          "-ac",
          "1",
          "-f",
          "wav",
          "-y",
          "pipe:1",
        ];

        log("Starting recording with args: " + JSON.stringify(recordArgs));
        recordingProcess = spawn("ffmpeg", recordArgs);
        let stderrOutput = "";

        recordingProcess.stdout.on("data", (data: Buffer) => {
          log(`Received audio chunk of size: ${data.length}`);
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
    // Stop the ffmpeg process
    recordingProcess.kill();
    isRecording = false;
    statusBarItem.text = "$(unmute) Start Dictation";

    // Wait a bit for any remaining data
    await new Promise((resolve) => setTimeout(resolve, 100));

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
    tempFilePath = path.join(os.tmpdir(), `dictation-${Date.now()}.wav`);
    debugFilePath = path.join(debugDir, `dictation-${timestamp}.wav`);

    // Combine audio chunks and write to files
    const audioBuffer = Buffer.concat(audioChunks);
    console.log("[WhisperDictation] Total audio chunks:", audioChunks.length);
    console.log("[WhisperDictation] Combined buffer size:", audioBuffer.length);

    if (audioBuffer.length === 0) {
      throw new Error("No audio data was captured");
    }

    // Add WAV header if missing
    const wavHeader = Buffer.alloc(44);
    wavHeader.write("RIFF", 0);
    wavHeader.writeUInt32LE(audioBuffer.length + 36, 4);
    wavHeader.write("WAVE", 8);
    wavHeader.write("fmt ", 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(1, 22);
    wavHeader.writeUInt32LE(16000, 24);
    wavHeader.writeUInt32LE(16000 * 2, 28);
    wavHeader.writeUInt16LE(2, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write("data", 36);
    wavHeader.writeUInt32LE(audioBuffer.length, 40);

    const finalBuffer = Buffer.concat([wavHeader, audioBuffer]);

    // Write files
    fs.writeFileSync(tempFilePath, finalBuffer);
    fs.writeFileSync(debugFilePath, finalBuffer);

    // Log file details with more information
    log(
      "Audio file details: " +
        JSON.stringify(
          {
            tempPath: tempFilePath,
            debugPath: debugFilePath,
            originalSize: audioBuffer.length,
            finalSize: finalBuffer.length,
            sizeInMB: (finalBuffer.length / (1024 * 1024)).toFixed(2) + " MB",
            firstFewBytes: Array.from(finalBuffer.slice(0, 32))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(" "),
            hasWavHeader: finalBuffer.slice(0, 4).toString() === "RIFF",
            sampleRate: finalBuffer.readUInt32LE(24),
            channels: finalBuffer.readUInt16LE(22),
            bitsPerSample: finalBuffer.readUInt16LE(34),
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

function getNonce() {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

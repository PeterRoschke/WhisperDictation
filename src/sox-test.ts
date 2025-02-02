import { spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

async function testSoxTermination() {
  const testFile = path.join(os.tmpdir(), `sox-test-${Date.now()}.ogg`);
  const soxPath = path.join(__dirname, "../resources/bin/win32/sox.exe"); // Update path as needed

  // Same SOX command as production
  const args = [
    "-c",
    "1",
    "-r",
    "16000",
    "-b",
    "16",
    "-e",
    "signed-integer",
    "-t",
    "waveaudio",
    "default",
    "--buffer",
    "1024",
    "-C",
    "0",
    "-t",
    "vorbis",
    testFile,
  ];

  let soxProcess: ChildProcess;
  let fileSizeHistory: number[] = [];

  // Start monitoring file size
  const monitor = setInterval(() => {
    try {
      const size = fs.existsSync(testFile) ? fs.statSync(testFile).size : 0;
      fileSizeHistory.push(size);
      console.log(`Current file size: ${size} bytes`);
    } catch (e) {
      console.error("Monitoring error:", e);
    }
  }, 50);

  // Start recording
  console.log("Starting SOX process...");
  soxProcess = spawn(soxPath, args, { windowsVerbatimArguments: true });

  // Wait 2 seconds before terminating
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Experiment with different termination methods
  const methods = [
    { name: "SIGTERM", signal: "SIGTERM" },
    { name: "SIGINT", signal: "SIGINT" },
    { name: "Kill()", signal: null },
    { name: "StdinClose", method: "stdinClose" },
  ];

  for (const method of methods) {
    console.log(`\nTesting termination method: ${method.name}`);
    fileSizeHistory = [];

    // Send termination signal
    if (method.signal) {
      soxProcess.kill(method.signal);
    } else if (method.method === "stdinClose") {
      soxProcess.stdin?.end();
    } else {
      soxProcess.kill();
    }

    // Monitor for 1 second after termination
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Analyze results
    const sizes = fileSizeHistory;
    const finalSize = sizes[sizes.length - 1] || 0;
    const maxSize = Math.max(...sizes);
    console.log(`Final size: ${finalSize} bytes, Max observed: ${maxSize} bytes`);

    // Wait before next test
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  clearInterval(monitor);
  cleanup(testFile);
}

function cleanup(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.error("Cleanup error:", e);
  }
}

testSoxTermination().catch(console.error);

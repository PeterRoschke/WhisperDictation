const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

async function testSoxTermination() {
  const methods = [
    { name: "Ctrl-C Simulation", method: "ctrlC" },
    { name: "Write 'q' to stdin", method: "stdinQ" },
    { name: "Taskkill Force", method: "taskkill" },
    { name: "Delayed Double Kill", method: "doubleKill" },
  ];

  // Test each method with fresh process
  for (const method of methods) {
    const testFile = path.join(os.tmpdir(), `sox-test-${Date.now()}-${method.name.replace(/\s+/g, "_")}.ogg`);
    const soxPath = path.join(__dirname, "resources/bin/win32/sox.exe");
    let soxProcess;
    let fileSizeHistory = [];

    console.log(`\n=== Testing ${method.name} ===`);

    // Start fresh monitoring
    const monitor = setInterval(() => {
      try {
        const size = fs.existsSync(testFile) ? fs.statSync(testFile).size : 0;
        fileSizeHistory.push(size);
      } catch (e) {
        console.error("Monitoring error:", e);
      }
    }, 10); // Faster polling

    // Start new process
    soxProcess = spawn(
      soxPath,
      [
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
      ],
      {
        windowsVerbatimArguments: true,
        stdio: ["pipe", "inherit", "inherit"],
      }
    );

    // Let it run for 2 seconds
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Apply termination method
    console.log(`Applying ${method.name}...`);
    try {
      switch (method.method) {
        case "ctrlC":
          // Send CTRL_C_EVENT for Windows
          soxProcess.kill("SIGINT");
          break;

        case "stdinQ":
          // Send SOX quit command
          soxProcess.stdin.write("q\n");
          await new Promise((resolve) => setTimeout(resolve, 500));
          break;

        case "taskkill":
          // Use Windows taskkill to terminate entire process tree
          spawn("taskkill", ["/pid", soxProcess.pid, "/f", "/t"]);
          break;

        case "doubleKill":
          // Gentle SIGINT followed by forceful kill
          soxProcess.kill("SIGINT");
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (!soxProcess.killed) soxProcess.kill();
          break;
      }
    } catch (e) {
      console.error("Termination error:", e);
    }

    // Extended monitoring period
    await new Promise((resolve) => setTimeout(resolve, 1000));
    clearInterval(monitor);

    // Check if process exited
    const exited = soxProcess.exitCode !== null;
    console.log(`Process exited: ${exited ? "Yes" : "No"}`);

    // Final size check with retries
    let finalSize = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        finalSize = fs.existsSync(testFile) ? fs.statSync(testFile).size : 0;
        break;
      } catch (e) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const maxSize = Math.max(...fileSizeHistory);
    console.log(`Results:
- Final size: ${finalSize} bytes
- Max during test: ${maxSize} bytes
- Difference: ${finalSize - maxSize} bytes
- Clean exit: ${exited}`);

    // Graceful cleanup
    await new Promise((resolve) => setTimeout(resolve, 1000));
    cleanup(testFile);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function cleanup(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.error("Cleanup error:", e);
  }
}

testSoxTermination().catch(console.error);

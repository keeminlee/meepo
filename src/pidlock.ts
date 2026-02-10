import fs from "node:fs";
import path from "node:path";

/**
 * PID lock file to prevent multiple bot instances running simultaneously
 */

const LOCK_FILE = path.join(process.cwd(), "data", "bot.pid");

function isPidRunning(pid: number): boolean {
  try {
    // send signal 0 to check if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    // ESRCH means process doesn't exist
    if (err.code === "ESRCH") return false;
    // EPERM means process exists but we don't have permission (still running)
    if (err.code === "EPERM") return true;
    return false;
  }
}

export function acquireLock(): boolean {
  const currentPid = process.pid;

  // Check if lock file exists
  if (fs.existsSync(LOCK_FILE)) {
    const existingPid = parseInt(fs.readFileSync(LOCK_FILE, "utf8").trim(), 10);
    
    if (!isNaN(existingPid) && isPidRunning(existingPid)) {
      console.error(`Bot already running (PID ${existingPid}). Exiting.`);
      return false;
    }
    
    console.log(`Stale lock file detected (PID ${existingPid}). Overwriting.`);
  }

  // Ensure data directory exists
  const dataDir = path.dirname(LOCK_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Write current PID to lock file
  fs.writeFileSync(LOCK_FILE, currentPid.toString(), "utf8");
  console.log(`PID lock acquired (${currentPid})`);
  
  return true;
}

export function releaseLock(): void {
  if (fs.existsSync(LOCK_FILE)) {
    fs.unlinkSync(LOCK_FILE);
    console.log("PID lock released");
  }
}

// Cleanup on exit
process.on("exit", () => {
  releaseLock();
});

// Cleanup on ctrl+c
process.on("SIGINT", () => {
  console.log("\nReceived SIGINT, shutting down...");
  releaseLock();
  process.exit(0);
});

// Cleanup on termination
process.on("SIGTERM", () => {
  console.log("\nReceived SIGTERM, shutting down...");
  releaseLock();
  process.exit(0);
});

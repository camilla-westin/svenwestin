import { spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const bin = path.join(process.cwd(), "node_modules", "astro", "astro.js");

const child = spawn(process.execPath, [bin, ...args], {
  stdio: "inherit",
  env: {
    ...process.env,
    ASTRO_TELEMETRY_DISABLED: "1",
  },
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  }
  process.exit(code ?? 1);
});

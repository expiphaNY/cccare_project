import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";

/**
 * Local serial bridge. Reads a Bluetooth serial (SPP) port that macOS created
 * when the sensor was paired (/dev/cu.<name>) and streams its lines to the page.
 *
 * Why: Chrome's Web Serial opens Bluetooth serial devices over its own RFCOMM
 * link, which fails for the MyoWare shield on macOS, while the OS port works.
 * This only makes sense when the web server runs on the same computer as the
 * sensor, so it is limited to requests made to localhost.
 */

const SKIP = /^cu\.(Bluetooth-Incoming-Port|debug-console|wlan-debug)/i;
export const PORT_RE = /^\/dev\/cu\.[\w.+-]+$/;

export function listSerialPorts(): string[] {
  try {
    return readdirSync("/dev")
      .filter((f) => f.startsWith("cu.") && !SKIP.test(f))
      .map((f) => `/dev/${f}`)
      .sort((a, b) => Number(/myoware/i.test(b)) - Number(/myoware/i.test(a)));
  } catch {
    return [];
  }
}

/** Only serve the bridge to pages opened on this computer. */
export function isLocalRequest(req: Request) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
}

// One reader per port: a reload or second tab replaces the previous reader.
const active = new Map<string, ChildProcess>();

/**
 * Opens the port once (fd 3), switches it to raw mode without echo, then
 * streams it with cat. Using one shell keeps the settings on the same open
 * file, so they can't reset between stty and the read.
 */
export function openPortStream(port: string): ReadableStream<Uint8Array> {
  active.get(port)?.kill();
  const child = spawn("/bin/sh", ["-c", 'exec 3<>"$PORT" && stty raw -echo clocal cread -crtscts 115200 <&3 && exec cat <&3'], {
    env: { PATH: "/bin:/usr/bin", PORT: port } as unknown as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  active.set(port, child);
  const enc = new TextEncoder();
  let stderr = "";
  let done = false;

  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(enc.encode("#OPENING\n"));
      child.stdout!.on("data", (b: Buffer) => {
        if (!done) ctrl.enqueue(new Uint8Array(b));
      });
      child.stderr!.on("data", (b: Buffer) => (stderr += b.toString()));
      child.on("close", (code, signal) => {
        if (active.get(port) === child) active.delete(port);
        if (done) return;
        done = true;
        const why = stderr.trim() || (signal ? `stopped (${signal})` : `exited with code ${code}`);
        ctrl.enqueue(enc.encode(`\n#ERROR ${why.replace(/\s+/g, " ")}\n`));
        ctrl.close();
      });
      child.on("error", (e) => {
        if (done) return;
        done = true;
        ctrl.enqueue(enc.encode(`\n#ERROR ${e.message}\n`));
        ctrl.close();
      });
    },
    cancel() {
      done = true;
      child.kill();
    },
  });
}

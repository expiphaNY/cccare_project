// =============================================================================
// route.ts : BACKUP CONNECTION: STREAMING THE SENSOR'S TEXT
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Part of the back-up way to reach the sensor (see lib/server/serial-bridge.ts). Opens the chosen
//   serial port and streams the sensor's lines of text to the page. Only allowed from this computer,
//   and only for ports that look like real serial ports.
// =============================================================================

import { PORT_RE, isLocalRequest, listSerialPorts, openPortStream } from "@/lib/server/serial-bridge";

/**
 * Backup connection: streams the sensor's lines of text to the page.
 * Lines starting with "#" are status messages, not sensor data.
 * Two safety checks: the request must come from localhost, and the port name
 * must be one we found ourselves. The stream stops when the page closes.
 */
export async function GET(req: Request) {
  if (!isLocalRequest(req)) return new Response("#ERROR The sensor bridge only works on localhost.\n", { status: 403 });
  const port = new URL(req.url).searchParams.get("port") ?? "";
  if (!PORT_RE.test(port) || !listSerialPorts().includes(port)) return new Response(`#ERROR Unknown port ${port}\n`, { status: 404 });

  const stream = openPortStream(port);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // no-transform stops compression from buffering the live stream.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

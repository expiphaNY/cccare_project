import { PORT_RE, isLocalRequest, listSerialPorts, openPortStream } from "@/lib/server/serial-bridge";

/**
 * GET /api/sensor/stream?port=/dev/cu.MyoWare_Shield
 * Streams the port's raw lines as text. Lines starting with "#" are bridge
 * status: "#OPENING", then "#ERROR <reason>" if the port closes or fails.
 * Localhost only; the stream stops when the page disconnects.
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

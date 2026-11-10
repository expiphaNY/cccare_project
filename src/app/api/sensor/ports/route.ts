import { isLocalRequest, listSerialPorts } from "@/lib/server/serial-bridge";

/** GET /api/sensor/ports: serial ports on this computer (localhost only). */
export async function GET(req: Request) {
  if (!isLocalRequest(req)) return Response.json({ error: "The sensor bridge only works when the site is opened on the computer the sensor is paired with (localhost)." }, { status: 403 });
  const ports = listSerialPorts().map((path) => ({ path, name: path.replace(/^\/dev\/cu\./, "") }));
  return Response.json({ ports }, { headers: { "Cache-Control": "no-store" } });
}

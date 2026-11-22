// =============================================================================
// route.ts : BACKUP CONNECTION: LISTING SERIAL PORTS
// =============================================================================
//
// WHAT THIS FILE DOES (high-level overview)
//   Part of the back-up way to reach the sensor (see lib/server/serial-bridge.ts). Lists the serial
//   ports on this computer so the page can pick the paired sensor. Refuses any request that does not
//   come from this computer (localhost).
// =============================================================================

import { isLocalRequest, listSerialPorts } from "@/lib/server/serial-bridge";

/** GET /api/sensor/ports: serial ports on this computer (localhost only). */
export async function GET(req: Request) {
  if (!isLocalRequest(req)) return Response.json({ error: "The sensor bridge only works when the site is opened on the computer the sensor is paired with (localhost)." }, { status: 403 });
  const ports = listSerialPorts().map((path) => ({ path, name: path.replace(/^\/dev\/cu\./, "") }));
  return Response.json({ ports }, { headers: { "Cache-Control": "no-store" } });
}

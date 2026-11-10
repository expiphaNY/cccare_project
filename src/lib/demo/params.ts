import "server-only";
import { getStore } from "@/lib/store";

/**
 * `generateStaticParams` sources for the static demo build. Pages only export
 * these when DEMO is on (`export const generateStaticParams = DEMO ? … : undefined`),
 * so normal builds stay fully request-time.
 */
type MaybePromise<T> = T | Promise<T>;

export async function patientParams() {
  return (await (await getStore()).listPatients()).map((p) => ({ pid: p.id }));
}

export async function sessionParams({ params }: { params: MaybePromise<{ pid: string }> }) {
  const { pid } = await params;
  return (await (await getStore()).listSessions(pid)).map((s) => ({ sid: s.id }));
}

export async function shareParams() {
  const store = await getStore();
  const out: { token: string }[] = [];
  for (const p of await store.listPatients()) for (const s of await store.listShares(p.id)) out.push({ token: s.token });
  return out;
}

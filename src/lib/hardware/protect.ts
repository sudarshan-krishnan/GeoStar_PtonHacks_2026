// Server-side link to SiteStar PROTECT, the service on the laptop wired to the physical model.
// PROTECT_URL points at it (a tunnel URL when the app runs in the cloud). Server routes only.

export const PROTECT_BASE = (process.env.PROTECT_URL || 'http://127.0.0.1:8796').replace(/\/$/, '');

export type ProjectRef = { id: string; name: string; city?: string; type?: string };

/** Connect the physical model to this project. Returns false when PROTECT is not reachable. */
export async function linkHardware(project: ProjectRef, by: 'dashboard' | 'deploy'): Promise<boolean> {
  try {
    const r = await fetch(`${PROTECT_BASE}/api/haven/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: project.id,
        name: project.name,
        city: project.city ?? '',
        type: project.type ?? '',
        by,
      }),
      signal: AbortSignal.timeout(by === 'deploy' ? 1500 : 4000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

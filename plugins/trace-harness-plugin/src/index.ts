/**
 * Trace's host half is intentionally empty in V1. The UI uses browser-memory
 * mock data only; this entry exists so the bundle has a normal Cordis host
 * module and a clear place for the future TraceClient service.
 */
export function apply() {
  // V2 will add the TraceClient service here. V1 must not call a backend.
}

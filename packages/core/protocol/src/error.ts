/** Stable error identity shared by every public Trace protocol validator. */
export class ProtocolError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TraceProtocolError';
  }
}

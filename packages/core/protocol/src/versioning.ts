import {ProtocolError} from './error.js';

export interface ProtocolVersioned {
  protocol_id: string;
  protocol_version: string;
}

export interface ProtocolUpcaster<T extends ProtocolVersioned> {
  protocol_id: string;
  from_version: string;
  to_version: string;
  upcast(value: Readonly<T>): T;
}

function versioned(value: unknown): ProtocolVersioned {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProtocolError('PROTOCOL_MISMATCH', 'Protocol value must be an object');
  const item = value as Record<string, unknown>;
  if (typeof item.protocol_id !== 'string' || item.protocol_id.length === 0 || typeof item.protocol_version !== 'string' || item.protocol_version.length === 0) throw new ProtocolError('PROTOCOL_MISMATCH', 'Protocol value must include protocol_id and protocol_version');
  return {protocol_id: item.protocol_id, protocol_version: item.protocol_version};
}

/**
 * Explicit, directed, in-memory protocol upcasting. It never mutates the
 * persisted envelope: callers may read old records through a newer canonical
 * model, while a durable rewrite remains a separate migration with a receipt.
 */
export class ProtocolVersionRegistry<T extends ProtocolVersioned = ProtocolVersioned> {
  private readonly edges = new Map<string, ProtocolUpcaster<T>>();

  register(upcaster: ProtocolUpcaster<T>): void {
    if (!upcaster.protocol_id || !upcaster.from_version || !upcaster.to_version || upcaster.from_version === upcaster.to_version) throw new ProtocolError('INVALID_UPCASTER', 'Protocol upcaster must advance one non-empty protocol version');
    const key = `${upcaster.protocol_id}@${upcaster.from_version}`;
    if (this.edges.has(key)) throw new ProtocolError('DUPLICATE_UPCASTER', `An upcaster is already registered for ${key}`);
    this.edges.set(key, upcaster);
  }

  upgrade(value: T, targetVersion: string): T {
    const initial = versioned(value);
    if (!targetVersion) throw new ProtocolError('INVALID_TARGET_VERSION', 'targetVersion must be non-empty');
    let current = structuredClone(value);
    const seen = new Set<string>();
    while (current.protocol_version !== targetVersion) {
      const key = `${current.protocol_id}@${current.protocol_version}`;
      if (seen.has(key)) throw new ProtocolError('UPCAST_CYCLE', `Protocol upcaster cycle at ${key}`);
      seen.add(key);
      const upcaster = this.edges.get(key);
      if (!upcaster) throw new ProtocolError('PROTOCOL_MIGRATION_REQUIRED', `No upcaster from ${key} to ${targetVersion}`);
      const next = upcaster.upcast(current);
      const verified = versioned(next);
      if (verified.protocol_id !== initial.protocol_id || verified.protocol_version !== upcaster.to_version) throw new ProtocolError('INVALID_UPCASTER', `Upcaster ${key} returned ${verified.protocol_id}@${verified.protocol_version}`);
      current = next;
    }
    return current;
  }

  supportedVersions(protocolId: string): string[] {
    const values = new Set<string>();
    for (const upcaster of this.edges.values()) if (upcaster.protocol_id === protocolId) { values.add(upcaster.from_version); values.add(upcaster.to_version); }
    return [...values].sort();
  }
}

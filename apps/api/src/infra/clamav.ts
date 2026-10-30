// Minimal clamd client: INSTREAM over TCP (ADR-0014). Returns the signature name when infected.
import { Socket } from 'node:net';

export type ScanVerdict = { clean: true } | { clean: false; signature: string };

const CHUNK = 64 * 1024;

export function clamdCommand(host: string, port: number, command: string, timeoutMs = 5000): Promise<string> {
  return talk(host, port, timeoutMs, (s) => s.write(`z${command}\0`));
}

export async function clamdScan(
  host: string,
  port: number,
  data: Uint8Array,
  timeoutMs = 60_000,
): Promise<ScanVerdict> {
  const reply = await talk(host, port, timeoutMs, (s) => {
    s.write('zINSTREAM\0');
    for (let i = 0; i < data.length; i += CHUNK) {
      const chunk = data.subarray(i, i + CHUNK);
      const len = Buffer.alloc(4);
      len.writeUInt32BE(chunk.length);
      s.write(len);
      s.write(chunk);
    }
    s.write(Buffer.alloc(4)); // a zero-length chunk ends the stream
  });
  // "stream: OK" | "stream: Eicar-Test-Signature FOUND" | "INSTREAM size limit exceeded. ERROR"
  if (/: OK$/.test(reply)) return { clean: true };
  const found = /: (.+) FOUND$/.exec(reply);
  if (found?.[1]) return { clean: false, signature: found[1] };
  throw new Error(`clamd: ${reply}`);
}

function talk(host: string, port: number, timeoutMs: number, send: (s: Socket) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const s = new Socket();
    const parts: Buffer[] = [];
    s.setTimeout(timeoutMs, () => s.destroy(new Error('clamd timeout')));
    s.on('data', (d) => parts.push(d));
    s.on('error', reject);
    s.on('close', () => resolve(Buffer.concat(parts).toString('utf8').replace(/\0/g, '').trim()));
    s.connect(port, host, () => send(s));
  });
}

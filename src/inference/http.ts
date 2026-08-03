const maximumResponseBytes = 2_097_152;
const maximumLineCharacters = 262_144;
const maximumErrorCharacters = 16_384;

export async function* decodeResponseLines(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  if (body === null) throw new Error('Inference provider returned an empty streaming body.');
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let received = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      received += next.value.byteLength;
      if (received > maximumResponseBytes) throw new Error(`Inference stream exceeds ${maximumResponseBytes} bytes.`);
      buffer += decoder.decode(next.value, { stream: true });
      if (buffer.length > maximumLineCharacters && !buffer.includes('\n')) {
        throw new Error(`Inference stream line exceeds ${maximumLineCharacters} characters.`);
      }
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/u, '');
        if (line.length > maximumLineCharacters) throw new Error(`Inference stream line exceeds ${maximumLineCharacters} characters.`);
        yield line;
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer.replace(/\r$/u, '');
  } finally {
    reader.releaseLock();
  }
}

export async function* decodeSseData(body: ReadableStream<Uint8Array> | null): AsyncGenerator<string> {
  let data: string[] = [];
  for await (const line of decodeResponseLines(body)) {
    if (line.length === 0) {
      if (data.length > 0) yield data.join('\n');
      data = [];
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /u, ''));
    }
  }
  if (data.length > 0) yield data.join('\n');
}

export async function requireSuccessfulResponse(response: Response, provider: string): Promise<void> {
  if (response.ok) return;
  let detail = '';
  try {
    for await (const line of decodeResponseLines(response.body)) {
      if (detail.length >= maximumErrorCharacters) break;
      detail += (detail.length === 0 ? '' : '\n') + line.slice(0, maximumErrorCharacters - detail.length);
    }
  } catch {
    detail = '';
  }
  throw new Error(`${provider} returned HTTP ${response.status}${detail.length === 0 ? '.' : `: ${detail}`}`);
}

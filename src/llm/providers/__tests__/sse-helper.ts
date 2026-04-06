// Shared test helper: builds a mock Response whose body is a ReadableStream
// that yields the given lines as SSE bytes.
export function makeSseResponse(lines: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream  = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'));
      }
      controller.close();
    },
  });
  return {
    ok:     status >= 200 && status < 300,
    status,
    body:   stream,
    text:   jest.fn().mockResolvedValue('mock error body'),
    json:   jest.fn().mockResolvedValue({}),
  } as unknown as Response;
}

export function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok:     status >= 200 && status < 300,
    status,
    body:   null,
    text:   jest.fn().mockResolvedValue(JSON.stringify(body)),
    json:   jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

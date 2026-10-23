export async function boundedRequest<Result>(
  request: (signal: AbortSignal) => Promise<Result>, timeoutMs: number, signal: AbortSignal,
): Promise<Result> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  let cancel: () => void = () => undefined
  const interrupted = new Promise<never>((_resolve, reject) => {
    cancel = () => {
      controller.abort()
      reject(new DOMException('Request cancelled', 'AbortError'))
    }
    if (signal.aborted) cancel()
    else signal.addEventListener('abort', cancel, { once: true })
    timeout = setTimeout(() => {
      reject(new Error('PocketHive request timed out'))
      controller.abort()
    }, timeoutMs)
  })
  try {
    return await Promise.race([interrupted, signal.aborted ? interrupted : request(controller.signal)])
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', cancel)
  }
}

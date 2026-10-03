export async function readEmailFunctionError(error: unknown): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = error.context
    if (context instanceof Response) {
      try {
        const body: unknown = await context.clone().json()
        if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
          return body.error
        }
      } catch {
        // The gateway can return a non-JSON error; use the normal error message.
      }
    }
  }
  return error instanceof Error ? error.message : 'The email service could not complete this request.'
}

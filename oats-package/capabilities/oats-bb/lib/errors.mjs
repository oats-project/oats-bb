// One error type for everything the provider refuses or cannot do. `code` is the word the
// kernel relays; `details.unconfirmed: true` marks an effect that may have happened.
export class ProviderError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function fail(code, message, details) {
  return new ProviderError(code, message, details);
}

export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

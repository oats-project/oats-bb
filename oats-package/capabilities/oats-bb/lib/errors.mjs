// One error type for everything the provider refuses or cannot do. `code` is the word the
// kernel relays; the message says what happened and, where an effect may have happened
// anyway (a tell or a spawn whose answer was lost), says that too.
export class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
  }
}

export function fail(code, message) {
  return new ProviderError(code, message);
}

export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

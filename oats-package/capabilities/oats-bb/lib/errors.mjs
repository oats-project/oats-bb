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

/** An outcome the provider cannot tell: an effect (a spawn, a tell) may have happened.
 *  It is never answered as a refusal, which says "nothing happened": the call ends with
 *  no answer and a nonzero exit, which the kernel reads as a failed call whose outcome is
 *  uncertain, and compensates (after a launch, it stops whatever runs in the home). */
export class InDoubt extends Error {
  constructor(message) {
    super(message);
    this.name = "InDoubt";
  }
}

export function fail(code, message) {
  return new ProviderError(code, message);
}

export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A verb's refusals carry that verb's own code: any other ProviderError is recoded to
 *  it, keeping its message. Anything that is not a ProviderError is a bug, and rethrown. */
export function recode(code, error) {
  if (!(error instanceof ProviderError)) throw error;
  return error.code === code ? error : fail(code, error.message);
}

/** The default of an RPC method no test of a slot should reach: a test that is about it overrides it. */
export const unexpected = (method: string) => (): never => {
  throw new Error(`unexpected rpc ${method}`);
};

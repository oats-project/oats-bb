// @vitest-environment jsdom
// The words of a failed read, and the one Notice that says them.
import { afterEach, expect, test } from "vitest";
import { cleanup } from "@testing-library/react";
import { codes } from "../../kernel/result";
import { failureWords } from "../../app/roster/unreadable";

afterEach(cleanup);

test("each failure has a title in a person's words, a sentence where one helps, and the acts that can mend it", () => {
  const said = (code: string, message = "raw", machine: string | null = "checks-host") => {
    const words = failureWords({ code, message }, machine);
    return [words.title, words.sentence, words.settings, words.retry];
  };
  expect(said(codes.notFound)).toEqual(["OATS is not installed on checks-host", "Install OATS there, or set the path to oats in the plugin's settings.", true, true]);
  expect(said(codes.noDeployment)).toEqual(["No OATS deployment found on checks-host", "Open a bb project inside the deployment, or set its directory in the plugin's settings.", true, true]);
  expect(said(codes.chooseHost)).toEqual(["Choose the machine that holds your agents", "This bb server has more than one machine.", true, false]);
  expect(said(codes.hostNotFound)).toEqual(["Couldn't reach checks-host", "The machine in the plugin's settings is not one of this bb server's.", true, true]);
  expect(said(codes.hostUnreachable)).toEqual(["Couldn't reach checks-host", null, false, true]);
  expect(said(codes.noHost)).toEqual(["Couldn't reach checks-host", null, false, true]);
  expect(said(codes.timeout)).toEqual(["OATS did not answer on checks-host", "It took more than 20 s.", false, true]);
  // A kernel refusal: its first line, after who says it; never the raw code as the title.
  expect(said("E_WORKSPACE_INVALID", "oats-workspace.yaml: unknown key `foo`\nsee the docs")).toEqual(["OATS could not read this deployment", "OATS says: oats-workspace.yaml: unknown key `foo`", false, true]);
  expect(said("PLUGIN_RPC_FAILED")).toEqual(["OATS could not be read", null, false, true]);
  // With no machine known, and a machine's name that is no text.
  expect(said(codes.notFound, "raw", null)[0]).toBe("OATS is not installed on this machine");
  expect(said(codes.timeout, "raw", "fal\u202Econ")[0]).toBe("OATS did not answer on fal\uFFFDcon");
  expect(said("E_X", "token=abc123")[1]).toBe("OATS says: [withheld]");
});

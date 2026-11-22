// A result or a failure told through bb's own toaster (the UX standard, section 3, "Result": the
// dialog's result lines first, then a notification with "Open <agent>" when the person has moved
// on). `sonner` is shimmed by bb for plugins: its `toast` is bb's own toast, drawn by bb and kept in
// its notification centre; the plugin mounts no Toaster of its own, and the package is a type-only
// devDependency at bb's version, never bundled.
import { toast } from "sonner";
import { onWindowReset } from "../store";
import { shown } from "./text";

export type Notification = {
  /** `failed` stays until a person dismisses it; `done` leaves by itself. */
  tone: "done" | "failed";
  /** What happened, in a person's words. */
  title: string;
  /** More of it, each a line under the title. */
  lines?: readonly string[];
  /** The next step, as a button: "Open <agent>". */
  open?: { label: string; run: () => void };
};

/** What was notified in this app window, in order, as it was drawn (through the display filter): for a slot test. */
const sent: Notification[] = [];
onWindowReset(() => {
  sent.length = 0;
});
export const notified = (): readonly Notification[] => sent;

/** Tell a result or a failure through bb's toaster. Text of OATS or an agent goes through the display filter here. */
export function notify({ tone, title, lines = [], open }: Notification): void {
  const drawn: Notification = {
    tone,
    title: shown(title),
    lines: lines.map((line) => shown(line)).filter((line) => line !== ""),
    ...(open === undefined ? {} : { open: { label: shown(open.label), run: open.run } }),
  };
  sent.push(drawn);
  const options = {
    ...(drawn.lines!.length === 0 ? {} : { description: drawn.lines!.join("\n") }),
    ...(drawn.open === undefined ? {} : { action: { label: drawn.open.label, onClick: () => drawn.open!.run() } }),
    // A failure stays until dismissed (the standard): it is never lost to a timer.
    ...(tone === "failed" ? { duration: Number.POSITIVE_INFINITY } : {}),
  };
  if (tone === "failed") toast.error(drawn.title, options);
  else toast.success(drawn.title, options);
}

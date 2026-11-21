// The contrast check of the app's live checks (container/live-ui.mjs): for what the plugin draws
// on a page, the WCAG contrast ratio of each text against its effective background, and of each
// state dot against what is behind it. One expression, evaluated in the page.
//
// What it covers: inside every element the plugin marks with `data-testid="oats-…"` (the sidebar
// block and tree, the identity row, the home, the four pages, the dialogs and the running line),
// every rendered element that has text of its own (rows, chips, card text, headings, links,
// buttons, the dialog's lines), what a field shows (the value typed into an input or a textarea,
// the chosen option of a select, or the placeholder of an empty one), and every state dot
// (`role="img"` with `data-state`). A row's thread title is bb's own component, drawn inside the
// plugin's row: it is covered too.
//
// How: the colours are the computed ones. A colour is resolved to sRGB by painting it on a
// one-pixel canvas (bb's tokens are oklch), over the backgrounds of the element's ancestors from
// the document's root down, so a translucent background or text colour is composited as the page
// composites it; an ancestor's `opacity` blends its content with what is behind it.
//
// It reads the page as it is when asked, whether an element is on screen or not: a sidebar that bb
// keeps mounted in its closed drawer (at phone width, in some loads) is counted too.
//
// What it cannot see, and why:
//   - a state the page is not in: hover, focus, active, a dialog that is not open, a refusal
//     that is not shown. live-ui.mjs brings up the ones it can (a typed name the form refuses, the
//     filled forms with their buttons enabled, the plan dialog);
//   - a disabled control, and what is inside one: skipped, as WCAG exempts it;
//   - the options of an open select: the browser draws that list, not the page;
//   - what is drawn but is no text and no state dot: borders, icons, focus rings;
//   - the text of a `display: contents` element: it has no box of its own, so it counts as not
//     rendered and is skipped, though its text is drawn;
//   - `::before` and `::after` content: generated text is no text node of the page;
//   - a background that is no colour (an image or a gradient on the element or an ancestor): the
//     row is reported as `unsure`, and the check fails on it rather than guess;
//   - something drawn over the text by an element that is not its ancestor (bb's own overlays);
//   - text the plugin does not draw: bb's own UI around it.
function contrastInPage() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  /** `color` (any CSS colour, with its alpha) painted over the opaque `backdrop` → [r, g, b]. */
  const over = (color, backdrop) => {
    context.fillStyle = `rgb(${backdrop.join(",")})`;
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
  };
  const mix = (backdrop, color, opacity) => color.map((channel, i) => Math.round(backdrop[i] + (channel - backdrop[i]) * opacity));
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((channel) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  /** The effective background inside `element`, and the colour `paint` has on it (null: none asked). */
  const resolve = (element, paint) => {
    const nodes = [];
    for (let node = element; node; node = node.parentElement) nodes.unshift(node);
    let unsure = null;
    const walk = (index, backdrop) => {
      const style = getComputedStyle(nodes[index]);
      if (style.backgroundImage !== "none") unsure = "a background that is no colour";
      const background = over(style.backgroundColor, backdrop);
      const inner = index === nodes.length - 1 ? { background, paint: paint === null ? background : over(paint, background) } : walk(index + 1, background);
      const opacity = Number(style.opacity);
      return opacity < 1 ? { background: mix(backdrop, inner.background, opacity), paint: mix(backdrop, inner.paint, opacity) } : inner;
    };
    return { ...walk(0, [255, 255, 255]), unsure };
  };
  const rendered = (element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== "hidden";
  };
  const named = (element) => {
    const text = ((element.tagName === "SELECT" ? element.selectedOptions[0]?.text : element.value) || element.innerText || element.getAttribute("placeholder") || element.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return `${element.closest("[data-testid]")?.getAttribute("data-testid") ?? "?"} <${element.tagName.toLowerCase()}> ${JSON.stringify(text)}`;
  };
  const roots = [...document.querySelectorAll('[data-testid^="oats-"]')].filter((element) => !element.parentElement?.closest('[data-testid^="oats-"]'));
  const rows = [];
  // The ratio is kept as computed and compared as computed; it is only printed cut to two decimals.
  const row = (kind, element, need, resolved, behind) =>
    rows.push({ kind, what: named(element), need, ratio: ratio(resolved.paint, behind), unsure: resolved.unsure, paint: resolved.paint.join(","), behind: behind.join(",") });
  for (const root of roots) {
    for (const element of [root, ...root.querySelectorAll("*")]) {
      if (!rendered(element)) continue;
      const style = getComputedStyle(element);
      if (element.getAttribute("role") === "img" && element.hasAttribute("data-state")) {
        // A state dot: its fill, or its border where it has no fill, against what is behind it.
        const filled = over(style.backgroundColor, [1, 2, 3]).join() !== "1,2,3";
        const dot = resolve(element.parentElement, filled ? style.backgroundColor : style.borderTopColor);
        // No fill and no border: a class that gives the dot no colour at all (a token bb does not have).
        if (!filled && parseFloat(style.borderTopWidth) === 0) dot.unsure = "a dot with no fill and no border";
        row("dot", element, 3, dot, dot.background);
        continue;
      }
      if (element.closest(":disabled, [aria-disabled='true']")) continue;
      const field = element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT";
      if (!field && [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== "")) {
        const text = resolve(element, style.color);
        row("text", element, 4.5, text, text.background);
      }
      // A field's own text is no text node: what is typed or chosen in it, else its placeholder.
      if (field && element.value !== "") {
        const value = resolve(element, style.color);
        row("value", element, 4.5, value, value.background);
      } else if (field && element.getAttribute("placeholder")) {
        const placeholder = resolve(element, getComputedStyle(element, "::placeholder").color);
        row("placeholder", element, 4.5, placeholder, placeholder.background);
      }
    }
  }
  return JSON.stringify({ theme: document.documentElement.classList.contains("dark") ? "dark" : "light", roots: roots.map((element) => element.getAttribute("data-testid")), rows });
}

/** The expression: → JSON of `{theme, roots, rows: [{kind: "text" | "value" | "placeholder" | "dot", what, need, ratio, unsure, paint, behind}]}`. */
export const CONTRAST = `(${contrastInPage.toString()})()`;

/** The rows that fail: a ratio under its floor, or a background the check cannot read. */
export const failing = (rows) => rows.filter((row) => row.ratio < row.need || row.unsure !== null);

/** A ratio as it is printed: cut, never rounded up, so that 4.499 does not read as 4.5. */
export const shown = (ratio) => String(Math.floor(ratio * 100) / 100);

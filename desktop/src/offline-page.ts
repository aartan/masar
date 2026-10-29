function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char] ?? char,
  );
}

/**
 * Local fallback shown when the window cannot reach the hosted sync app (for
 * example when Windows starts the app without a network connection). Keeping
 * this in the Electron shell means the user never sees Chromium's blank error
 * page, and can retry or continue in the offline local workspace.
 */
export function connectionErrorPage({
  origin,
  description,
  canUseLocal,
}: {
  origin: string;
  description: string;
  canUseLocal: boolean;
}): string {
  const target = JSON.stringify(origin).replace(/</g, "\\u003c");
  const reason = escapeHtml(description);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Masar — Connection lost</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #f7f6f1;
      color: #20241f;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main { width: 100%; max-width: 440px; text-align: center; }
    .mark {
      display: inline-grid;
      place-items: center;
      width: 56px;
      height: 56px;
      border-radius: 16px;
      background: #2f5d46;
      box-shadow: 0 6px 18px rgb(47 93 70 / 22%);
    }
    .eyebrow {
      margin: 18px 0 0;
      font-size: 10px;
      letter-spacing: .18em;
      text-transform: uppercase;
      opacity: .5;
    }
    h1 { margin: 10px 0 0; font-size: 24px; line-height: 1.2; letter-spacing: -.02em; }
    .description {
      margin: 12px 0 0;
      border: 1px solid rgb(180 60 50 / 18%);
      border-radius: 10px;
      background: rgb(180 60 50 / 6%);
      padding: 9px 12px;
      color: #9f2f27;
      font-size: 12px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .hint { margin: 16px 0 0; color: #687067; font-size: 13px; line-height: 1.65; }
    .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 24px; }
    button {
      appearance: none;
      border: 1px solid #2f5d46;
      border-radius: 9px;
      background: #2f5d46;
      color: #f4f6ee;
      padding: 9px 16px;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #274d3a; }
    button.secondary { border-color: rgb(32 36 31 / 16%); background: transparent; color: #20241f; }
    button.secondary:hover { background: rgb(32 36 31 / 6%); }
    button:focus-visible { outline: 2px solid #2f5d46; outline-offset: 2px; }
    @media (prefers-color-scheme: dark) {
      body { background: #111512; color: #e7ebe3; }
      .description { border-color: rgb(255 130 120 / 22%); background: rgb(255 130 120 / 9%); color: #ffaaa2; }
      .hint { color: #9ba49a; }
      button { border-color: #5d8c72; background: #35684e; }
      button:hover { background: #3d7658; }
      button.secondary { border-color: rgb(231 235 227 / 16%); background: transparent; color: #e7ebe3; }
      button.secondary:hover { background: rgb(231 235 227 / 6%); }
      button:focus-visible { outline-color: #7fb494; }
    }
  </style>
</head>
<body>
  <main>
    <span class="mark" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="4.5" height="16" rx="2.25" fill="#f4f6ee" />
        <rect x="9.75" y="4" width="4.5" height="10.5" rx="2.25" fill="#f4f6ee" opacity=".72" />
        <rect x="16.5" y="4" width="4.5" height="13.5" rx="2.25" fill="#f4f6ee" opacity=".44" />
      </svg>
    </span>
    <p class="eyebrow">Masar</p>
    <h1>Can't reach your workspace</h1>
    <p class="description">${reason}</p>
    <p class="hint">
      Check your connection and try again.${canUseLocal ? " You can also continue in your local workspace while the hosted app is unavailable." : ""}
    </p>
    <div class="actions">
      <button id="retry" type="button" autofocus>Try again</button>
      ${canUseLocal ? '<button id="local" type="button" class="secondary">Use local workspace</button>' : ""}
    </div>
  </main>
  <script>
    const target = ${target};
    document.getElementById("retry").addEventListener("click", () => {
      window.location.replace(target);
    });
    ${
      canUseLocal
        ? `document.getElementById("local").addEventListener("click", () => {
      const api = window.masarDesktop;
      if (api && typeof api.switchToLocal === "function") {
        void api.switchToLocal();
      } else {
        window.location.replace(target);
      }
    });`
        : ""
    }
    window.addEventListener("online", () => window.location.replace(target));
  </script>
</body>
</html>`;
}

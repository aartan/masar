"use client";

import * as React from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#f7f6f1",
          color: "#20241f",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              opacity: 0.5,
              margin: 0,
            }}
          >
            Kanso
          </p>
          <h1
            style={{
              fontSize: 26,
              lineHeight: 1.2,
              letterSpacing: "-0.02em",
              margin: "12px 0 0",
            }}
          >
            The workspace could not start
          </h1>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.65,
              opacity: 0.65,
              margin: "10px 0 0",
            }}
          >
            Kanso could not connect to its database. Confirm that{" "}
            <code>DATABASE_URL</code> is set correctly, then reload this page.
            {error.digest ? ` Reference: ${error.digest}.` : ""}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              height: 36,
              padding: "0 16px",
              borderRadius: 8,
              border: "none",
              background: "#2f5d46",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

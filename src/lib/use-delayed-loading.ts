import * as React from "react";

/**
 * Delays a loading indicator so fast, local-first reads do not flash a
 * skeleton for a frame or two. Returns false immediately once loading ends.
 */
export function useDelayedLoading(loading: boolean, delay = 120): boolean {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!loading) {
      setVisible(false);
      return;
    }

    const timer = window.setTimeout(() => setVisible(true), delay);
    return () => window.clearTimeout(timer);
  }, [loading, delay]);

  return loading && visible;
}

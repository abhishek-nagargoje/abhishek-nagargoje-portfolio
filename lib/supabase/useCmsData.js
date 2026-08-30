"use client";
import { useEffect, useState } from "react";

// Fetches CMS content client-side (this is a static export — there is no server
// to fetch on). Starts from the given local fallback so nothing renders blank,
// and silently keeps that fallback if Supabase is unreachable or misconfigured.
export function useCmsData(fetchFn, fallback) {
  const [data, setData] = useState(fallback);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetchFn()
      .then((result) => {
        if (cancelled) return;
        const isEmpty = Array.isArray(result) ? result.length === 0 : !result;
        if (!isEmpty) setData(result);
      })
      .catch(() => {
        // Keep the local fallback already in state.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading };
}

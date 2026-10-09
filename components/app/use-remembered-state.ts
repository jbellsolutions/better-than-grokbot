"use client";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** localStorage belongs to each instance's origin and native partition. */
export function useRememberedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initial);
  const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const raw = localStorage.getItem(key);
        const saved = raw === null ? initial : JSON.parse(raw);
        setValue(saved === null || typeof saved === typeof initial ? saved : initial);
      } catch { setValue(initial); }
      setLoaded(key);
    }, 0);
    return () => clearTimeout(timer);
    // The initial value is a fallback, not a reason to reload an existing selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (loaded !== key) return;
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
  }, [key, loaded, value]);
  return [loaded === key ? value : initial, setValue];
}

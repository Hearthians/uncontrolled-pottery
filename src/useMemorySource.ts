import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MemorySource } from "./memorySource";

export function useMemorySource(locked: boolean) {
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const [source] = useState(() => new MemorySource(`${import.meta.env.BASE_URL}memories.json`, () => lockedRef.current));
  const state = useSyncExternalStore(source.subscribe, source.getSnapshot);
  useEffect(() => {
    void source.loadDefault();
    return source.cancel;
  }, [source]);
  return { ...state, source, canStart: source.canStart };
}

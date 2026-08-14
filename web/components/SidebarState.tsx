'use client';
import { createContext, useCallback, useContext, useState } from 'react';

type Ctx = { open: boolean; toggle: () => void; close: () => void; openMenu: () => void };
const SidebarCtx = createContext<Ctx | null>(null);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen(v => !v), []);
  const close = useCallback(() => setOpen(false), []);
  const openMenu = useCallback(() => setOpen(true), []);
  return <SidebarCtx.Provider value={{ open, toggle, close, openMenu }}>{children}</SidebarCtx.Provider>;
}

export function useSidebar() {
  const ctx = useContext(SidebarCtx);
  if (!ctx) throw new Error('useSidebar outside provider');
  return ctx;
}

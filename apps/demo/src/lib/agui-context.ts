import { createContext } from 'react';

export const AguiWriteGuard = createContext<
  ((action: string) => boolean) | null
>(null);

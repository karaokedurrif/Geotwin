import { createContext, useContext } from 'react';
import type { ActiveTool } from '../types';

interface ToolContextValue {
  activeTool: ActiveTool;
}

const ctx = createContext<ToolContextValue>({ activeTool: 'orbit' });

export const ToolProvider = ctx.Provider;
export const useToolContext = () => useContext(ctx);

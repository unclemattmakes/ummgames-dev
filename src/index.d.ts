export declare function defineConfig<T extends object>(config: T): T
export declare function findGameRoot(cwd?: string): string
export declare function loadConfigFile(
  cwd?: string,
): Promise<{ root: string; file: string | null; config: Record<string, unknown> }>
export declare function loadConfig<D extends Record<string, unknown>>(
  section: string,
  defaults: D,
  cwd?: string,
): Promise<D & { root: string }>

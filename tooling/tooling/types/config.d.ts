import type { UserConfig } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

export type LibraryOptions = { entry: Record<string, string> };
export type LibraryConfig = Omit<UserConfig, "pack"> & { pack: PackUserConfig };
export declare function defineLibrary(options: LibraryOptions): LibraryConfig;
export declare function defineCliLibrary(options: LibraryOptions): LibraryConfig;
export declare function defineVueLibrary(options: LibraryOptions): Promise<LibraryConfig>;
export declare function defineApp(): Promise<UserConfig>;
export declare function defineDocs(): UserConfig;
export declare function defineWorkspace(options: {
  testInclude: string[];
  verifyCommand: string;
}): Promise<UserConfig>;
export declare function defineTooling(): UserConfig;

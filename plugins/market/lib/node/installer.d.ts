import { Context, Dict, HTTP, Schema, Service } from 'koishi';
import { DependencyMetaKey, PackageJson, RemotePackage } from '@koishijs/registry';
declare module '@koishijs/registry' {
    interface PackageJson {
        resolutions?: Dict<string>;
    }
}
export interface Dependency {
    /** name */
    name: string;
    /**
     * yarn protocol
     * @example `workspace`, `npm`, `git`
     */
    protocol: string;
    /**
     * override package name, empty for default name
     *
     * git: url for git protocol
     */
    path?: string;
    /** workspace name for monorepo, default to name */
    workspaceName?: string;
    /**
     * requested semver range
     *
     * git: requested tag
     * @example `^1.2.3` -> `1.2.3`
     * @example `v1.2.3`
     */
    request: string;
    /**
     * installed package version
     *
     * git: same as request
     * @example `1.2.5`
     * @example `v1.2.3`
     */
    resolved?: string;
    /** whether it is a workspace package */
    workspace?: boolean;
    /** valid (unsupported) syntax */
    invalid?: boolean;
    /** latest version */
    latest?: string;
}
export declare namespace Dependency {
    const RESOLUTION_PREFIX = "\u25B6";
    function isResolution(name: string): boolean;
    function asResolution(name: string): string;
    function asDependency(name: string): string;
    function parse(name: string, request: string): Dependency;
    function stringify(dep: Dependency, target: string): string;
}
export interface YarnLog {
    type: 'warning' | 'info' | 'error' | string;
    name: number | null;
    displayName: string;
    indent?: string;
    data: string;
}
export interface LocalPackage extends PackageJson {
    private?: boolean;
    $workspace?: boolean;
}
export declare function loadManifest(name: string): LocalPackage;
declare class Installer extends Service {
    ctx: Context;
    config: Installer.Config;
    http: HTTP;
    endpoint: string;
    fullCache: Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>>;
    tempCache: Dict<Dict<Pick<RemotePackage, DependencyMetaKey>>>;
    private pkgTasks;
    private agent;
    private manifest;
    private depTask;
    private flushData;
    private git;
    constructor(ctx: Context, config: Installer.Config);
    get cwd(): string;
    start(): Promise<void>;
    resolveName(name: string): string[];
    findVersion(names: string[]): Promise<{
        [name]: string;
    }>;
    private _getPackage;
    private _getGitPackage;
    setPackage(name: string, versions: RemotePackage[]): void;
    getPackage(name: string, dep?: Dependency): Promise<Dict<Pick<RemotePackage, DependencyMetaKey>>>;
    _loadManifest2(name: string): LocalPackage;
    private _getDeps;
    getDeps(): Promise<Dict<Dependency>>;
    refreshData(): void;
    refresh(refresh?: boolean, purge?: boolean): void;
    exec(args: string[]): Promise<number>;
    override(deps: Dict<string>): Promise<void>;
    private _install;
    install(deps: Dict<string>, forced?: boolean): Promise<number>;
}
declare namespace Installer {
    interface Config {
        endpoint?: string;
        timeout?: number;
    }
    const Config: Schema<Config>;
}
export default Installer;

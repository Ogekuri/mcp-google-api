#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

interface ToolConfig {
    name: string;
    description: string;
    schema: Record<string, z.ZodTypeAny>;
    annotations?: ToolAnnotations;
    action: (params: any) => Promise<any>;
}
declare class BaseMcpServer {
    protected readonly server: McpServer;
    private sessions;
    private httpServer;
    private serverName;
    private tools;
    constructor(name: string, tools: ToolConfig[]);
    private createMcpServer;
    connect(transport: Transport): Promise<void>;
    startHttpServer(port: number, host?: string): Promise<void>;
    startStdio(): Promise<void>;
    stopHttpServer(): Promise<void>;
}

type RuntimeConfigSource = "flag" | "settings";
interface ResolvedRuntimeConfig {
    apiKey: string | undefined;
    apiKeySource: "flag" | "settings" | "none";
    host: string;
    hostSource: RuntimeConfigSource;
    port: number | undefined;
    portRaw: string | undefined;
    portSource: RuntimeConfigSource;
    enabledToolsRaw: string;
    enabledToolsSource: RuntimeConfigSource;
    autoUpdateDisabled: boolean;
}

type SnippetClient = "generic" | "claude" | "cursor" | "pi";
type SnippetTransport = "stdio" | "http";
type SnippetLauncher = "npx" | "node" | "bin";
interface SnippetOptions {
    client?: SnippetClient;
    transport?: SnippetTransport;
    launcher?: SnippetLauncher;
    commandPath?: string;
    host?: string;
    port?: number;
    serverName?: string;
}

interface ServerStartupOutcome {
    started: number;
    failed: number;
    servers: BaseMcpServer[];
}
declare function startServer(port: number, apiKey?: string, host?: string): Promise<ServerStartupOutcome>;
type ShutdownExitHook = (code: number) => void;
declare function createShutdownHandler(servers: readonly BaseMcpServer[], exitHook?: ShutdownExitHook): (signal: string) => Promise<void>;
declare function installShutdownHandlers(servers: readonly BaseMcpServer[]): void;
declare const EXEC_TOOLS: readonly ["maps_geocode", "maps_reverse_geocode", "maps_search_nearby", "maps_search_places", "maps_place_details", "maps_directions", "maps_distance_matrix", "maps_elevation", "maps_timezone", "maps_weather", "maps_explore_area", "maps_plan_route", "maps_compare_places", "maps_air_quality", "maps_static_map", "maps_batch_geocode", "maps_search_along_route", "maps_local_rank_tracker"];
interface ExecOutput {
    write(chunk: string): unknown;
}
interface ExecStreams {
    stdout: ExecOutput;
    stderr: ExecOutput;
}
type ExecToolRunner = (toolName: string, params: any, apiKey: string) => Promise<unknown>;
type DoctorCheck = {
    name: string;
    status: "pass" | "fail" | "skip";
    detail: string;
};
type DoctorReport = {
    success: boolean;
    version: string;
    live: boolean;
    checks: DoctorCheck[];
};
type DoctorToolRunner = (toolName: string, params: any, apiKey: string) => Promise<unknown>;
declare function execTool(toolName: string, params: any, apiKey: string): Promise<any>;
declare function runExecCommand(toolName: string, params: any, apiKey: string, runner?: ExecToolRunner, streams?: ExecStreams): Promise<number>;
type DoctorProbeId = "geocoding" | "places-new" | "routes";
interface DoctorLiveProbe {
    readonly id: DoctorProbeId;
    readonly name: string;
    readonly tool: string;
    readonly params: Record<string, unknown>;
}
declare const DOCTOR_PROBES: readonly DoctorLiveProbe[];
interface DoctorProbesParseResult {
    probes: DoctorProbeId[] | undefined;
    error?: string;
}
declare function parseDoctorProbes(raw: string | undefined): DoctorProbesParseResult;
interface DoctorOptions {
    probes?: readonly DoctorProbeId[];
    nodeVersion?: string;
    config?: ResolvedRuntimeConfig;
    allToolNames?: readonly string[];
}
declare function runDoctor(packageVersion: string, apiKey: string | undefined, live?: boolean, runner?: DoctorToolRunner, options?: DoctorOptions): Promise<DoctorReport>;
declare function runSnippetCommand(options: SnippetOptions, streams?: ExecStreams): number;
declare function runEnableDisableCliCommand(name: string, enable: boolean, options?: {
    home?: string;
    streams?: ExecStreams;
}): number;
declare function runApiKeyCommand(key: string | undefined, options: {
    home?: string;
    resourcesRoot: string;
    streams?: ExecStreams;
}): number;
declare function runAutoUpdateCommand(rawState: string | undefined, options?: {
    home?: string;
    streams?: ExecStreams;
}): number;
declare function runToolsCommand(raw: string | undefined, options?: {
    home?: string;
    streams?: ExecStreams;
}): number;
declare function runHostCommand(raw: string | undefined, options?: {
    home?: string;
    streams?: ExecStreams;
}): number;
declare function runPortCommand(raw: string | undefined, options?: {
    home?: string;
    streams?: ExecStreams;
}): number;
declare function runInstallUninstallCommand(operation: "install" | "uninstall", options: {
    home?: string;
    resourcesRoot: string;
    includeDebugSkills?: boolean;
    streams?: ExecStreams;
}): number;
declare function runShowCommand(options: {
    home?: string;
    resourcesRoot: string;
    streams?: ExecStreams;
}): number;
declare function describeUndispatchedServerStart(args: readonly string[]): string | undefined;
declare function handleUndispatchedEntry(args: readonly string[], streams?: {
    stderr: {
        write: (text: string) => unknown;
    };
}): number;

export { DOCTOR_PROBES, type DoctorCheck, type DoctorLiveProbe, type DoctorOptions, type DoctorProbeId, type DoctorProbesParseResult, type DoctorReport, EXEC_TOOLS, type ServerStartupOutcome, type ShutdownExitHook, createShutdownHandler, describeUndispatchedServerStart, execTool, handleUndispatchedEntry, installShutdownHandlers, parseDoctorProbes, runApiKeyCommand, runAutoUpdateCommand, runDoctor, runEnableDisableCliCommand, runExecCommand, runHostCommand, runInstallUninstallCommand, runPortCommand, runShowCommand, runSnippetCommand, runToolsCommand, startServer };

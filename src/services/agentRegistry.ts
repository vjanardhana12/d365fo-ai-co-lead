import * as vscode from 'vscode';
import * as crypto from 'crypto';

/**
 * A user-defined agent. Stored in globalState (shared across workspaces) or, when
 * a workspace folder is open, optionally synced to `<workspace>/.d365fo-co-lead/agents/<id>.agent.json`
 * so the team can share via git. (Repo sync arrives in v1.1; v1.0 = globalState only.)
 */
export interface AgentDefinition {
  id: string;
  name: string;
  /** One of the standard role IDs (architect | fc | dev-lead | developer | tester | pm) or 'custom'. */
  role: string;
  description: string;
  /** System prompt the agent uses when invoked. */
  systemPrompt: string;
  /** Names of MCP servers this agent should have access to. */
  allowedMcpServers: string[];
  /** Optional VS Code chat participant ID this agent routes to (defaults to role-mapped). */
  participantId?: string;
  scope: 'global' | 'project';
  /** ID of the connection this is bound to (only when scope = 'project'). */
  connectionId?: string;
  createdUtc: string;
  updatedUtc: string;
}

const KEY = 'd365fo.agents.global';

export class AgentRegistry {
  constructor(private ctx: vscode.ExtensionContext) {}

  loadAll(): AgentDefinition[] {
    return this.ctx.globalState.get<AgentDefinition[]>(KEY, []);
  }

  loadForRole(role: string): AgentDefinition[] {
    return this.loadAll().filter(a => a.role === role);
  }

  loadForConnection(connectionId: string | undefined): AgentDefinition[] {
    const all = this.loadAll();
    return all.filter(a => a.scope === 'global' || a.connectionId === connectionId);
  }

  get(id: string): AgentDefinition | undefined {
    return this.loadAll().find(a => a.id === id);
  }

  upsert(agent: AgentDefinition): void {
    const all = this.loadAll();
    const idx = all.findIndex(a => a.id === agent.id);
    agent.updatedUtc = new Date().toISOString();
    if (idx >= 0) all[idx] = agent; else all.push(agent);
    void this.ctx.globalState.update(KEY, all);
  }

  delete(id: string): void {
    const all = this.loadAll().filter(a => a.id !== id);
    void this.ctx.globalState.update(KEY, all);
  }

  newId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  /**
   * Seed the registry with one starter agent per role, so users see something useful on first run.
   * Idempotent: only adds agents whose IDs aren't present yet.
   */
  seedDefaults(): void {
    const seeds: AgentDefinition[] = [
      this.makeSeed('seed-architect', 'Solution Architect', 'architect',
        'Reviews architecture decisions, proposes HLD outlines, identifies cross-module impact.',
        'You are a D365 F&O Solution Architect. Read the active project spec, review design questions, propose patterns aligned with F&O best practices and the project conventions. Always cite which AOT objects / models are affected.',
        ['D365FODevMCP', 'microsoft.docs.mcp']),
      this.makeSeed('seed-fc', 'Functional Consultant', 'fc',
        'Drafts FDDs, performs fit-gap, clarifies business process scope.',
        'You are a D365 F&O Functional Consultant. Convert business requirements into functional design with clear scenarios, fit/gap, configuration impact, and security/permission considerations.',
        ['D365FODevMCP', 'ado', 'microsoft.docs.mcp']),
      this.makeSeed('seed-dev-lead', 'Dev Lead', 'dev-lead',
        'Plans dev tasks from FDDs/TDDs, recommends preset/hours/reviewer, triages PRs.',
        'You are a D365 F&O Development Lead. Given an ADO work item or FDD, propose Dev Tasks (Code Extensions / Technical Review / TD / CR / UT / WT) with hours and reviewer assignments. Use project iteration and preset conventions.',
        ['ado', 'D365FODevMCP']),
      this.makeSeed('seed-developer', 'Developer', 'developer',
        'Implements TDDs in X++ via D365FODevMCP, writes labels, fixes BP/UT.',
        'You are a D365 F&O Developer. Given a TDD or work item, implement objects via D365FODevMCP tools (tables, classes, forms, EDTs, security). Follow project naming conventions, prefix, label rules. After every change, build and fix any BP errors.',
        ['D365FODevMCP', 'ado']),
      this.makeSeed('seed-tester', 'Tester', 'tester',
        'Generates test cases from FDD, executes via DevMachine MCP, captures defects.',
        'You are a D365 F&O Tester. Generate functional test cases from the FDD. Execute interactive tests via DevMachine MCP, capture screenshots and errors, and report defects back with reproduction steps.',
        ['DevMachine', 'ado', 'D365FODevMCP']),
      this.makeSeed('seed-pm', 'Project Manager', 'pm',
        'Status rollup, burndown, risk view (coming soon - placeholder).',
        'You are a D365 F&O Project Manager assistant. Aggregate ADO work items into status reports and burndowns for the active sprint.',
        ['ado']),
    ];
    const existing = this.loadAll();
    const existingIds = new Set(existing.map(a => a.id));
    let added = 0;
    for (const s of seeds) {
      if (!existingIds.has(s.id)) {
        existing.push(s);
        added++;
      }
    }
    if (added > 0) {
      void this.ctx.globalState.update(KEY, existing);
    }
  }

  private makeSeed(id: string, name: string, role: string, description: string, systemPrompt: string, mcps: string[]): AgentDefinition {
    const now = new Date().toISOString();
    return {
      id,
      name,
      role,
      description,
      systemPrompt,
      allowedMcpServers: mcps,
      scope: 'global',
      createdUtc: now,
      updatedUtc: now,
    };
  }
}

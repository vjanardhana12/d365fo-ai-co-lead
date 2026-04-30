import * as vscode from 'vscode';
import { ConnectionStore } from '../services/connectionStore';

/**
 * AI-mode entry points. These commands open Copilot Chat with a role-specific
 * participant pre-mentioned and a context-aware prompt seeded from the active
 * connection's project spec. The user then refines and sends.
 *
 * Pure UI handoff — backend reasoning lives in the chat agent.
 */
export function registerAiModeCommands(
  ctx: vscode.ExtensionContext,
  connections: ConnectionStore,
): void {
  ctx.subscriptions.push(
    vscode.commands.registerCommand('d365fo.devTasks.askAi', async () => {
      const c = connections.getActive();
      if (!c) {
        vscode.window.showWarningMessage('No active connection. Add one via Project Initiation Kit.');
        return;
      }
      const parent = await vscode.window.showInputBox({
        prompt: 'Parent ADO work item ID to plan dev tasks for',
        placeHolder: 'e.g. 12345',
        validateInput: v => /^\d+$/.test(v) ? null : 'Enter a numeric work item ID',
      });
      if (!parent) return;

      const spec = c.projectSpec ?? {};
      const ctxLines = [
        `**Project:** ${c.name}`,
        `**ADO project:** ${c.adoProject}`,
        spec.iteration ? `**Iteration:** ${spec.iteration}` : '',
        spec.defaultReviewer ? `**Default reviewer:** ${spec.defaultReviewer}` : '',
        spec.ceWorkItemType ? `**CE work item type:** ${spec.ceWorkItemType}` : '',
      ].filter(Boolean).join('\n');

      const prompt = `Plan dev tasks under parent #${parent}.\n\n${ctxLines}\n\nFetch the parent via the ADO MCP, summarise scope from the description/comments/attachments, recommend a preset (XS/S/M/L/XL) with hours per task, propose a developer + reviewer if signals exist, and show the plan as a table. Wait for my OK before creating anything.`;

      await vscode.commands.executeCommand('workbench.action.chat.open', {
        query: `@d365fo-dev-lead ${prompt}`,
      });
    }),
  );
}

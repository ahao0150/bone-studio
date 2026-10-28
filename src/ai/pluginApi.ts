/**
 * AI / automation extension surface.
 *
 * A capability receives the live editor `Player` plus a prompt, and returns **commands**
 * (not mutations) so the caller can show them for review and apply them through the same
 * path as the UI — everything stays undoable.
 *
 * The contract is deliberately tiny: `plan(player, prompt) -> EditorCommand[]`.
 * Everything the editor can do is reachable from `Player` (skeleton data + animation, plus
 * the command helpers in `core/editing`), so a capability never has to touch rendering.
 */

import type { Player } from '../core/player';

export interface EditorCommand {
  id: string;
  /** human-readable summary, shown for review before applying */
  label: string;
  /** applies the change; the caller owns history/undo/refresh */
  apply(player: Player): void;
}

export interface AiCapability {
  id: string;
  title: string;
  description: string;
  /** Produce commands (not mutations) for user review. */
  plan(player: Player, prompt: string): Promise<EditorCommand[]>;
}

const registry = new Map<string, AiCapability>();

export function registerAiCapability(capability: AiCapability): void {
  registry.set(capability.id, capability);
}

/** 卸载一个能力（插件被禁用 / 卸载时用）。返回是否真的删掉了。 */
export function unregisterAiCapability(id: string): boolean {
  return registry.delete(id);
}

export function listAiCapabilities(): AiCapability[] {
  return [...registry.values()];
}

export function findAiCapability(id: string): AiCapability | undefined {
  return registry.get(id);
}

/**
 * Collect commands from one named capability, or from every registered capability when
 * `capabilityId` is omitted. Capabilities that cannot handle the prompt return `[]`.
 */
export async function planAiCommands(
  player: Player,
  prompt: string,
  capabilityId?: string,
): Promise<EditorCommand[]> {
  const wanted = capabilityId
    ? [registry.get(capabilityId)].filter((entry): entry is AiCapability => Boolean(entry))
    : listAiCapabilities();
  const out: EditorCommand[] = [];
  for (const capability of wanted) {
    const planned = await capability.plan(player, prompt);
    out.push(...planned);
  }
  return out;
}

/** Apply a planned command list in order; returns how many commands ran. */
export function applyAiCommands(player: Player, commands: EditorCommand[]): number {
  let applied = 0;
  for (const command of commands) {
    command.apply(player);
    applied++;
  }
  return applied;
}
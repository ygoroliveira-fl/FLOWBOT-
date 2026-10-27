import { helpRegistry, infoCommands } from './info.js';
import { musicCommands } from './music.js';
import { playlistCommands } from './playlist.js';
import { queueCommands } from './queue.js';
import { settingsCommands } from './settings.js';
import type { Command } from './types.js';

export const commands: Command[] = [
  ...musicCommands,
  ...queueCommands,
  ...playlistCommands,
  ...settingsCommands,
  ...infoCommands,
];

export const commandMap = new Map(commands.map((command) => [command.name, command]));

for (const command of commands) {
  helpRegistry.push({
    name: command.name,
    category: command.category,
    description: command.data.description,
  });
}

export function commandPayloads() {
  return commands.map((command) => command.data);
}

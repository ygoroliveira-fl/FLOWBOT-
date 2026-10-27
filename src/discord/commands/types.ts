import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { AppContext } from '../context.js';

export interface Command {
  name: string;
  /** Categoria para o /help. */
  category: 'Música' | 'Fila' | 'Playlists' | 'Configuração' | 'Informações';
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  /** Se a resposta deve ser deferida imediatamente (operações que podem passar de 3 s). */
  defer?: 'public' | 'ephemeral';
  execute(app: AppContext, interaction: ChatInputCommandInteraction<'cached'>): Promise<void>;
  autocomplete?(app: AppContext, interaction: AutocompleteInteraction<'cached'>): Promise<void>;
}

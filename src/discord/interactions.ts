import { randomUUID } from 'node:crypto';
import {
  DiscordAPIError,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { isUserError, RateLimitedError, UserError } from '../core/errors.js';
import { scrubSecrets } from '../core/logger.js';
import type { Action } from '../permissions/permissions.js';
import {
  CONFIRM_PREFIX,
  PANEL_PREFIX,
  QUEUE_PREFIX,
  SEARCH_PREFIX,
  VOLUME_PREFIX,
  panelComponents,
  parseCustomId,
  queuePager,
  volumeControls,
  type ParsedCustomId,
} from '../ui/components.js';
import {
  endedPanelEmbed,
  errorEmbed,
  idlePanelEmbed,
  infoEmbed,
  panelEmbed,
  queueEmbed,
  successEmbed,
  LOOP_LABEL,
} from '../ui/embeds.js';
import { commandMap } from './commands/index.js';
import { enqueueAndReply, ensureSession } from './commands/shared.js';
import {
  EPHEMERAL,
  requirePermission,
  requireSession,
  requireVoice,
  type AppContext,
  type GuildInteraction,
} from './context.js';

type ComponentInteraction = ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>;

export async function handleInteraction(app: AppContext, interaction: Interaction): Promise<void> {
  if (!interaction.inGuild()) {
    if (interaction.isRepliable()) {
      await interaction
        .reply({ embeds: [errorEmbed('Use os comandos dentro de um servidor.')], flags: EPHEMERAL })
        .catch(() => undefined);
    }
    return;
  }
  if (!interaction.inCachedGuild()) {
    if (interaction.isRepliable()) {
      await interaction
        .reply({
          embeds: [errorEmbed('Ainda estou carregando este servidor. Tente de novo em instantes.')],
          flags: EPHEMERAL,
        })
        .catch(() => undefined);
    }
    return;
  }
  if (interaction.isChatInputCommand()) return runCommand(app, interaction);
  if (interaction.isAutocomplete()) return runAutocomplete(app, interaction);
  if (interaction.isButton() || interaction.isStringSelectMenu())
    return runComponent(app, interaction);
}

async function runCommand(
  app: AppContext,
  interaction: ChatInputCommandInteraction<'cached'>,
): Promise<void> {
  const command = commandMap.get(interaction.commandName);
  const started = performance.now();
  let outcome = 'ok';
  try {
    if (!command)
      throw new UserError('Comando desconhecido. Os comandos podem estar sendo atualizados.');
    const limit = await app.rateLimiter.consume(`cmd:${interaction.user.id}`, 8, 10_000);
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterMs);
    if (command.defer)
      await interaction.deferReply(command.defer === 'ephemeral' ? { flags: EPHEMERAL } : {});
    await command.execute(app, interaction);
  } catch (error) {
    outcome = isUserError(error) ? 'user_error' : 'error';
    await replyError(app, interaction, error, { command: interaction.commandName });
  } finally {
    app.metrics.commands.inc({ command: interaction.commandName, outcome });
    app.metrics.commandDuration.observe(
      { command: interaction.commandName },
      (performance.now() - started) / 1000,
    );
  }
}

async function runAutocomplete(
  app: AppContext,
  interaction: AutocompleteInteraction<'cached'>,
): Promise<void> {
  const command = commandMap.get(interaction.commandName);
  try {
    if (!command?.autocomplete) return await interaction.respond([]);
    await command.autocomplete(app, interaction);
  } catch (error) {
    app.logger.debug({ err: error, command: interaction.commandName }, 'Autocomplete falhou');
    await interaction.respond([]).catch(() => undefined);
  }
}

async function runComponent(app: AppContext, interaction: ComponentInteraction): Promise<void> {
  const parsed = parseCustomId(interaction.customId);
  const label = parsed ? `${parsed.prefix}:${parsed.action}` : 'unknown';
  let outcome = 'ok';
  try {
    if (!parsed) throw new UserError('Este controle não é mais válido.');
    // Cada painel controla exclusivamente o servidor em que foi criado.
    if (parsed.guildId !== interaction.guildId)
      throw new UserError('Este controle pertence a outro servidor.');
    const limit = await app.rateLimiter.consume(`btn:${interaction.user.id}`, 6, 5_000);
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterMs);

    switch (parsed.prefix) {
      case PANEL_PREFIX:
        return await handlePanel(app, interaction as ButtonInteraction<'cached'>, parsed);
      case QUEUE_PREFIX:
        return await handleQueuePage(app, interaction as ButtonInteraction<'cached'>, parsed);
      case VOLUME_PREFIX:
        return await handleVolume(app, interaction as ButtonInteraction<'cached'>, parsed);
      case SEARCH_PREFIX:
        return await handleSearchPick(
          app,
          interaction as StringSelectMenuInteraction<'cached'>,
          parsed,
        );
      case CONFIRM_PREFIX:
        return await handleConfirm(app, interaction as ButtonInteraction<'cached'>, parsed);
      default:
        throw new UserError('Este controle não é mais válido.');
    }
  } catch (error) {
    outcome = isUserError(error) ? 'user_error' : 'error';
    await replyError(app, interaction, error, { component: label });
  } finally {
    app.metrics.commands.inc({ command: `component:${label}`, outcome });
  }
}

const PANEL_ACTIONS: Record<string, Action> = {
  prev: 'previous',
  toggle: 'pause',
  skip: 'skip',
  stop: 'stop',
  loop: 'loop',
  shuffle: 'shuffle',
  queue: 'view',
  volume: 'volume',
};

async function handlePanel(
  app: AppContext,
  interaction: ButtonInteraction<'cached'>,
  parsed: ParsedCustomId,
): Promise<void> {
  const action = PANEL_ACTIONS[parsed.action];
  if (!action) throw new UserError('Este controle não é mais válido.');
  const session = app.sessions.get(interaction.guildId);

  // Botão de uma sessão encerrada (mensagem antiga ou bot reiniciado): desativa o painel.
  if (!session || session.destroyed) {
    await interaction.update({
      embeds: [endedPanelEmbed(app.brand, 'Esta sessão terminou. Use `/play` para começar outra.')],
      components: [],
    });
    return;
  }

  if (parsed.action === 'queue') {
    const view = queueEmbed(session, 0, app.brand);
    await interaction.reply({
      embeds: [view.embed],
      components: queuePager(interaction.guildId, view.page, view.pages),
      flags: EPHEMERAL,
    });
    return;
  }
  requireVoice(interaction, session);

  if (parsed.action === 'volume') {
    await requirePermission(app, interaction, 'volume');
    await interaction.reply({
      embeds: [infoEmbed(`Volume atual: **${session.volume}%** (máximo ${session.maxVolume}%).`)],
      components: volumeControls(interaction.guildId, session.volume, session.maxVolume),
      flags: EPHEMERAL,
    });
    return;
  }

  // Autorização no momento do clique; o estado visual do botão nunca é confiável.
  const own = parsed.action === 'skip' && session.current?.requesterId === interaction.user.id;
  await requirePermission(app, interaction, own ? 'skip.own' : action);
  await interaction.deferUpdate();

  let feedback: string | null = null;
  switch (parsed.action) {
    case 'prev':
      await session.previous();
      break;
    case 'toggle':
      feedback = (await session.togglePause()) ? 'Pausado.' : 'Retomado.';
      break;
    case 'skip': {
      const skipped = await session.skip(parsed.arg);
      if (!skipped) feedback = 'A faixa já tinha mudado — nada foi pulado.';
      break;
    }
    case 'stop':
      await session.stop();
      feedback = 'Reprodução parada.';
      break;
    case 'loop':
      feedback = `Repetição: ${LOOP_LABEL[await session.cycleLoop()]}.`;
      break;
    case 'shuffle':
      feedback = `Fila embaralhada (${await session.shuffle()} faixas).`;
      break;
  }
  // Atualiza a própria mensagem clicada (painel ou cópia efêmera) com o estado real.
  await interaction.editReply({
    embeds: [session.current ? panelEmbed(session, app.brand) : idlePanelEmbed(session, app.brand)],
    components: panelComponents(session, interaction.guildId),
  });
  if (feedback && parsed.action === 'skip') {
    await interaction.followUp({ embeds: [infoEmbed(feedback)], flags: EPHEMERAL });
  }
}

async function handleQueuePage(
  app: AppContext,
  interaction: ButtonInteraction<'cached'>,
  parsed: ParsedCustomId,
): Promise<void> {
  const session = app.sessions.get(interaction.guildId);
  if (!session || session.destroyed) {
    await interaction.update({ embeds: [infoEmbed('A sessão terminou.')], components: [] });
    return;
  }
  const view = queueEmbed(session, Number(parsed.arg ?? 0) || 0, app.brand);
  await interaction.update({
    embeds: [view.embed],
    components: queuePager(interaction.guildId, view.page, view.pages),
  });
}

async function handleVolume(
  app: AppContext,
  interaction: ButtonInteraction<'cached'>,
  parsed: ParsedCustomId,
): Promise<void> {
  const session = requireSession(app, interaction);
  requireVoice(interaction, session);
  await requirePermission(app, interaction, 'volume');
  const target = Number(parsed.arg);
  if (!Number.isInteger(target)) throw new UserError('Valor de volume inválido.');
  const applied = await session.setVolume(target);
  await interaction.update({
    embeds: [successEmbed(`Volume: **${applied}%** (máximo ${session.maxVolume}%).`)],
    components: volumeControls(interaction.guildId, applied, session.maxVolume),
  });
}

async function handleSearchPick(
  app: AppContext,
  interaction: StringSelectMenuInteraction<'cached'>,
  parsed: ParsedCustomId,
): Promise<void> {
  const pending = parsed.arg ? app.pendingSearches.get(parsed.arg) : undefined;
  if (!pending) {
    await interaction.update({
      embeds: [infoEmbed('Esta pesquisa expirou. Use `/search` novamente.')],
      components: [],
    });
    return;
  }
  if (pending.userId !== interaction.user.id)
    throw new UserError('Só quem fez a pesquisa pode escolher.');
  const settings = await requirePermission(app, interaction, 'play');
  const chosen = interaction.values
    .map((value) => pending.tracks[Number(value)])
    .filter((track): track is NonNullable<typeof track> => Boolean(track));
  if (!chosen.length) throw new UserError('Seleção inválida.');
  await interaction.deferUpdate();
  app.pendingSearches.take(parsed.arg!);
  const session = await ensureSession(app, interaction, settings);
  await interaction.editReply({ components: [] });
  await enqueueAndReply(app, interaction, session, chosen);
}

async function handleConfirm(
  app: AppContext,
  interaction: ButtonInteraction<'cached'>,
  parsed: ParsedCustomId,
): Promise<void> {
  const pending = parsed.arg ? app.pendingConfirmations.get(parsed.arg) : undefined;
  if (!pending) {
    await interaction.update({
      embeds: [infoEmbed('Esta confirmação expirou. Nada foi alterado.')],
      components: [],
    });
    return;
  }
  if (pending.userId !== interaction.user.id)
    throw new UserError('Só quem iniciou a ação pode confirmá-la.');
  app.pendingConfirmations.take(parsed.arg!);
  if (parsed.action === 'no') {
    await interaction.update({
      embeds: [infoEmbed('Cancelado. Nada foi alterado.')],
      components: [],
    });
    return;
  }
  await interaction.deferUpdate();
  const message = await pending.run();
  await interaction.editReply({ embeds: [successEmbed(message)], components: [] });
}

/** Erro → mensagem útil e efêmera; detalhes técnicos só no log, com código de correlação. */
async function replyError(
  app: AppContext,
  interaction: GuildInteraction | ChatInputCommandInteraction<'cached'>,
  error: unknown,
  context: Record<string, string>,
): Promise<void> {
  if (error instanceof DiscordAPIError && (error.code === 10062 || error.code === 40060)) {
    // Interação expirada (>3 s) ou já respondida: não há como responder.
    app.logger.warn({ ...context, code: error.code }, 'Interação expirada');
    return;
  }
  let embed;
  if (isUserError(error)) {
    embed = errorEmbed(error.userMessage);
  } else {
    const correlationId = randomUUID().slice(0, 8);
    app.metrics.errors.inc({ source: 'interaction' });
    app.logger.error(
      {
        ...context,
        correlationId,
        guildId: interaction.guildId,
        err:
          error instanceof Error
            ? { name: error.name, message: scrubSecrets(error.message), stack: error.stack }
            : String(error),
      },
      'Erro inesperado em interação',
    );
    embed = errorEmbed('Algo deu errado do meu lado. Tente novamente em instantes.', correlationId);
  }
  try {
    if (interaction.deferred || interaction.replied) {
      if (interaction.deferred && !interaction.replied && !interaction.isMessageComponent()) {
        await interaction.editReply({ embeds: [embed], components: [] });
      } else {
        await interaction.followUp({ embeds: [embed], flags: EPHEMERAL });
      }
    } else {
      await interaction.reply({ embeds: [embed], flags: EPHEMERAL });
    }
  } catch (replyErrorCause) {
    app.logger.debug({ err: replyErrorCause }, 'Falha ao responder erro');
  }
}

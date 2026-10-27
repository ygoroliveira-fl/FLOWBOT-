import { describe, expect, it } from 'vitest';
import { buildFilters, FILTER_PRESET_IDS, playbackSpeed } from '../../src/audio/filters.js';
import {
  customId,
  panelComponents,
  parseCustomId,
  searchMenu,
  volumeControls,
} from '../../src/ui/components.js';
import { addedEmbed, panelEmbed, queueEmbed } from '../../src/ui/embeds.js';
import {
  formatDuration,
  parseTimestamp,
  progressBar,
  safeText,
  trackLink,
} from '../../src/ui/format.js';
import { makeSession, makeTrack } from '../helpers/fakes.js';

const brand = { name: 'Aurora', accent: 0x7c5cff };
const GUILD = '123456789012345678';

describe('formatação', () => {
  it('durações e timestamps', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65_000)).toBe('1:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(-1)).toBe('--:--');
    expect(parseTimestamp('90')).toBe(90_000);
    expect(parseTimestamp('1:30')).toBe(90_000);
    expect(parseTimestamp('1:02:03')).toBe(3_723_000);
    expect(parseTimestamp('1:75')).toBeNull();
    expect(parseTimestamp('abc')).toBeNull();
  });

  it('barra de progresso tem largura fixa', () => {
    expect([...progressBar(0, 100, 10)]).toHaveLength(10);
    expect(progressBar(50, 100, 11)).toBe('━━━━━●─────');
    expect(progressBar(500, 100, 5)).toBe('━━━━●');
    expect(progressBar(10, 0, 4)).toBe('────');
  });

  it('neutraliza menções e markdown de títulos externos', () => {
    const text = safeText('@everyone **negrito** <@123> [link](http://x)');
    expect(text).not.toContain('@everyone');
    expect(text).toContain('@​everyone');
    expect(text).toContain('\\*\\*');
    expect(trackLink('Título', 'javascript:alert(1)')).toBe('**Título**');
    expect(trackLink('T', 'https://youtube.com/watch?v=1')).toContain(
      '](https://youtube.com/watch?v=1)',
    );
  });
});

describe('componentes', () => {
  it('customId carrega o servidor e é validado', () => {
    const id = customId('pnl', 'skip', GUILD, 'uid-1');
    expect(parseCustomId(id)).toEqual({
      prefix: 'pnl',
      action: 'skip',
      guildId: GUILD,
      arg: 'uid-1',
    });
    expect(parseCustomId('pnl:skip:nao-e-id')).toBeNull();
    expect(parseCustomId('lixo')).toBeNull();
    expect(() => customId('x', 'y', GUILD, 'z'.repeat(100))).toThrow();
  });

  it('desativa controles incompatíveis com o estado', async () => {
    const idle = panelComponents(null, GUILD).flatMap((row) =>
      row.components.map((c) => c.toJSON()),
    );
    expect(idle.every((c) => 'disabled' in c && c.disabled)).toBe(true);

    const { session } = await makeSession();
    await session.enqueue([makeTrack()], 'u');
    const active = panelComponents(session, GUILD).flatMap((row) =>
      row.components.map(
        (c) => c.toJSON() as { custom_id: string; disabled?: boolean; label?: string },
      ),
    );
    const byAction = (a: string) => active.find((c) => c.custom_id.startsWith(`pnl:${a}:`))!;
    expect(byAction('toggle').disabled).toBe(false);
    expect(byAction('prev').disabled).toBe(true); // sem histórico
    expect(byAction('shuffle').disabled).toBe(true); // fila < 2
    expect(byAction('skip').custom_id).toContain(session.current!.uid);
    await session.setPaused(true);
    const paused = panelComponents(session, GUILD)[0]!.components[1]!.toJSON() as { label: string };
    expect(paused.label).toContain('Retomar');
  });

  it('controles de volume respeitam limites', () => {
    const rows = volumeControls(GUILD, 150, 150).flatMap((r) =>
      r.components.map((c) => c.toJSON() as { custom_id: string; disabled?: boolean }),
    );
    expect(rows.find((c) => c.custom_id.endsWith(':150') && c.disabled)).toBeTruthy();
    expect(rows[0]!.custom_id).toBe(`vol:set:${GUILD}:130`);
  });

  it('menu de pesquisa limita a 10 opções e 100 caracteres', () => {
    const tracks = Array.from({ length: 12 }, () => makeTrack({ title: 'x'.repeat(300) }));
    const menu = searchMenu(GUILD, 'tok', tracks)[0]!.components[0]!.toJSON() as {
      options: { label: string }[];
      max_values: number;
    };
    expect(menu.options).toHaveLength(10);
    expect(menu.max_values).toBe(10);
    expect(menu.options.every((o) => o.label.length <= 100)).toBe(true);
  });
});

describe('embeds', () => {
  it('painel mostra faixa, solicitante, fila e estados', async () => {
    const { session, engine } = await makeSession();
    engine.position = 60_000;
    await session.enqueue(
      [
        makeTrack({ title: 'Primeira', artworkUrl: 'https://img/x.jpg' }),
        makeTrack(),
        makeTrack(),
        makeTrack(),
        makeTrack(),
      ],
      'user1',
    );
    const json = panelEmbed(session, brand).toJSON();
    expect(json.title).toBe('Primeira');
    expect(json.author?.name).toContain('Tocando agora');
    expect(json.thumbnail?.url).toBe('https://img/x.jpg');
    expect(json.description).toContain('1:00');
    expect(json.fields?.find((f) => f.name === 'Pedido por')?.value).toBe('<@user1>');
    expect(json.fields?.find((f) => f.name === 'A seguir')?.value).toContain('e mais 1 faixa');
    expect(json.footer?.text).toContain('4 faixas na fila');
    await session.setPaused(true);
    expect(panelEmbed(session, brand).toJSON().author?.name).toContain('Pausado');
  });

  it('transmissão ao vivo não exibe barra de progresso', async () => {
    const { session } = await makeSession();
    await session.enqueue([makeTrack({ isStream: true, isSeekable: false })], 'u');
    expect(panelEmbed(session, brand).toJSON().description).toContain('AO VIVO');
  });

  it('fila longa é paginada', async () => {
    const { session } = await makeSession();
    await session.enqueue(
      Array.from({ length: 26 }, () => makeTrack()),
      'u',
    );
    const view = queueEmbed(session, 99, brand);
    expect(view.pages).toBe(3);
    expect(view.page).toBe(2);
    expect(view.embed.toJSON().description).toContain('25.');
  });

  it('resumo de adição de playlist', () => {
    const embed = addedEmbed({
      added: [],
      rejected: 2,
      playlistName: 'Rock',
      startedPlaying: false,
      queuePositionStart: 1,
    }).toJSON();
    expect(embed.description).toContain('Rock');
    expect(embed.description).toContain('2 faixas ignoradas');
  });
});

describe('filtros', () => {
  it('todo preset gera corpo válido e "off" limpa', () => {
    for (const id of FILTER_PRESET_IDS) expect(typeof buildFilters(id)).toBe('object');
    expect(buildFilters('off')).toEqual({});
    expect(playbackSpeed('nightcore')).toBe(1.2);
    expect(playbackSpeed('bassboost')).toBe(1);
  });
});

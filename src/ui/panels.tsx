// Settings panels for the selected item, shown in pop-ups from either the
// sidebar's item menu or the toolbar above the item, plus the shared list of
// actions each item kind offers.

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, ArrowUpRight, Bold, ChevronDown, ChevronUp, Columns3, ExternalLink, Link2, Maximize2, PenLine, Rows3, Search, Trash2, Type,
} from 'lucide-react';
import { useBoard, type Item, type TextAlign, type TextSize } from '../board/store';
import { useUi, type PanelKey } from '../board/ui';
import { confirmDelete, enterBoard } from '../board/actions';
import { COLOR_PRESETS } from '../lib/color';
import { BOARD_ICONS, iconLabel } from '../lib/icons';
import { ColorWheel } from './ColorWheel';
import { BoardIcon } from './BoardIcon';
import { openViewer } from './MediaViewer';
import { effectiveIcon, guessIcon } from '../lib/iconGuess';

type Patch = Parameters<ReturnType<typeof useBoard.getState>['updateItem']>[1];
const update = (id: string, patch: Patch) => useBoard.getState().updateItem(id, patch);

export const ICON_PROPS = { size: 16, strokeWidth: 1.8, strokeLinecap: 'square', strokeLinejoin: 'miter' } as const;

function PanelSection({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <section className="panel-section">
      {label && <h3>{label}</h3>}
      {children}
    </section>
  );
}

// --- Colour ------------------------------------------------------------------

interface ColorPanelProps {
  value: string | null;
  presets: string[];
  /** What null means here, e.g. "Default" or "No strip". */
  noneLabel: string;
  /** CSS background for the null swatch; omitted = a "none" slash. */
  noneBackground?: string;
  onChange: (v: string | null) => void;
}

function ColorPanel({ value, presets, noneLabel, noneBackground, onChange }: ColorPanelProps) {
  const isCustom = value != null && !presets.includes(value.toUpperCase());
  const [custom, setCustom] = useState(isCustom);

  return (
    <>
      <PanelSection>
        <div className="swatches">
          <button
            className={noneBackground ? 'swatch' : 'swatch swatch-none'}
            title={noneLabel}
            aria-label={noneLabel}
            aria-pressed={value == null}
            style={noneBackground ? { background: noneBackground } : undefined}
            onClick={() => onChange(null)}
          />
          {presets.map((c) => (
            <button
              key={c}
              className="swatch"
              title={c}
              aria-label={c}
              aria-pressed={value?.toUpperCase() === c}
              style={{ background: c }}
              onClick={() => onChange(c)}
            />
          ))}
        </div>
      </PanelSection>
      <PanelSection>
        {custom ? (
          <ColorWheel value={value} onChange={onChange} />
        ) : (
          <button className="panel-button" onClick={() => setCustom(true)}>
            <span className="rainbow-dot" aria-hidden="true" />
            Custom colour…
          </button>
        )}
      </PanelSection>
    </>
  );
}

// --- Text --------------------------------------------------------------------

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { value: T; label: ReactNode; title: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          aria-label={o.title}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function TextPanel({ item }: { item: Extract<Item, { kind: 'note' }> }) {
  return (
    <PanelSection label="Text">
      <Segmented<TextSize>
        label="Text size"
        value={item.textSize}
        onChange={(v) => update(item.id, { textSize: v })}
        options={[
          { value: 'sm', label: <span style={{ fontSize: 11 }}>Small</span>, title: 'Small text' },
          { value: 'md', label: <span style={{ fontSize: 13 }}>Medium</span>, title: 'Medium text' },
          { value: 'lg', label: <span style={{ fontSize: 15 }}>Large</span>, title: 'Large text' },
        ]}
      />
      <div className="panel-row">
        <Segmented<TextAlign>
          label="Alignment"
          value={item.textAlign}
          onChange={(v) => update(item.id, { textAlign: v })}
          options={[
            { value: 'left', label: <AlignLeft {...ICON_PROPS} />, title: 'Align left' },
            { value: 'center', label: <AlignCenter {...ICON_PROPS} />, title: 'Align centre' },
            { value: 'right', label: <AlignRight {...ICON_PROPS} />, title: 'Align right' },
          ]}
        />
        <button
          className="panel-toggle"
          title="Bold"
          aria-label="Bold"
          aria-pressed={item.bold}
          onClick={() => update(item.id, { bold: !item.bold })}
        >
          <Bold {...ICON_PROPS} strokeWidth={2.4} />
        </button>
      </div>
    </PanelSection>
  );
}

// --- Icon --------------------------------------------------------------------

interface IconPanelProps {
  /** Chosen icon; null = guessed from the board's name. */
  value: string | null;
  guess: string;
  color: string | null;
  onChange: (v: string | null) => void;
}

function IconPanel({ value, guess, color, onChange }: IconPanelProps) {
  const [query, setQuery] = useState('');
  const names = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = Object.keys(BOARD_ICONS);
    return q ? all.filter((n) => iconLabel(n).includes(q)) : all;
  }, [query]);

  return (
    <PanelSection label="Icon">
      <label className="panel-search">
        <Search {...ICON_PROPS} size={14} aria-hidden="true" />
        <input autoFocus value={query} placeholder="Search icons" onChange={(e) => setQuery(e.target.value)} />
      </label>
      <button className="panel-auto" aria-pressed={value == null} onClick={() => onChange(null)}>
        <BoardIcon icon={guess} color={value == null ? color : null} size={16} className="icon-cell" />
        <span>
          <strong>Automatic</strong>
          <small>Picked from the board's name</small>
        </span>
      </button>
      <div className="icon-grid">
        {names.map((n) => (
          <button
            key={n}
            title={iconLabel(n)}
            aria-label={iconLabel(n)}
            aria-pressed={value === n}
            onClick={() => onChange(n)}
          >
            <BoardIcon icon={n} color={value === n ? color : null} size={18} className="icon-cell" />
          </button>
        ))}
        {names.length === 0 && <p className="panel-empty">No icons match “{query}”.</p>}
      </div>
    </PanelSection>
  );
}

// --- Rename ------------------------------------------------------------------

function RenamePanel({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (v: string) => void }) {
  return (
    <PanelSection label="Name">
      <input
        className="panel-input"
        autoFocus
        value={value}
        placeholder={placeholder}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') useUi.getState().set({ flyout: null });
        }}
      />
    </PanelSection>
  );
}

/** The body of a settings pop-up for one item. */
export function Panel({ item, panel }: { item: Item; panel: PanelKey }) {
  switch (panel) {
    case 'color': {
      if (item.kind === 'media') return null;
      const def = `var(--${item.kind}-default)`;
      return <ColorPanel value={item.color} presets={COLOR_PRESETS} noneLabel="Default" noneBackground={def} onChange={(v) => update(item.id, { color: v })} />;
    }
    case 'strip':
      if (item.kind !== 'column') return null;
      return <ColorPanel value={item.strip} presets={COLOR_PRESETS} noneLabel="No strip" onChange={(v) => update(item.id, { strip: v })} />;
    case 'text':
      return item.kind === 'note' ? <TextPanel item={item} /> : null;
    case 'icon':
      return item.kind === 'board'
        ? <IconPanel value={item.icon} guess={guessIcon(item.title)} color={item.color} onChange={(v) => update(item.id, { icon: v })} />
        : null;
    case 'rename':
      if (item.kind !== 'column' && item.kind !== 'board') return null;
      return <RenamePanel value={item.title} placeholder={`Untitled ${item.kind}`} onChange={(v) => update(item.id, { title: v })} />;
  }
}

// --- Actions -----------------------------------------------------------------

export interface ItemAction {
  key: string;
  label: string;
  /** Small visual for the button: a swatch preview or an icon. */
  glyph: ReactNode;
  /** Opens this panel… */
  panel?: PanelKey;
  /** …or runs this. */
  run?: () => void;
  danger?: boolean;
}

/** What you can do with an item, in display order. `isOpenBoard` = the board you're inside. */
export function itemActions(item: Item, isOpenBoard = false): ItemAction[] {
  const colorGlyph = <span className="glyph-swatch" style={{ background: ('color' in item && item.color) || `var(--${item.kind}-default)` }} />;
  const color: ItemAction = { key: 'color', label: 'Colour', glyph: colorGlyph, panel: 'color' };
  const del: ItemAction = {
    key: 'delete', label: 'Delete', glyph: <Trash2 {...ICON_PROPS} size={18} />, run: () => confirmDelete(item.id), danger: true,
  };

  switch (item.kind) {
    case 'note':
      return [color, { key: 'text', label: 'Text', panel: 'text', glyph: <Type {...ICON_PROPS} size={18} /> }, del];
    case 'todo':
      return [color, del];
    case 'media':
      return [
        {
          key: 'rename', label: 'Rename', glyph: <PenLine {...ICON_PROPS} size={18} />,
          // Renames inline, in the caption (shown again if it was tucked away).
          run: () => {
            update(item.id, { captionHidden: false });
            useUi.getState().set({ editingId: item.id, flyout: null });
          },
        },
        item.captionHidden
          ? { key: 'caption', label: 'Show name', glyph: <ChevronUp {...ICON_PROPS} size={18} />, run: () => update(item.id, { captionHidden: false }) }
          : { key: 'caption', label: 'Hide name', glyph: <ChevronDown {...ICON_PROPS} size={18} />, run: () => update(item.id, { captionHidden: true }) },
        { key: 'open', label: 'Open', glyph: <Maximize2 {...ICON_PROPS} size={18} />, run: () => openViewer(item.id) },
        del,
      ];
    case 'link':
      return [
        color,
        {
          key: 'edit', label: 'Edit link', glyph: <Link2 {...ICON_PROPS} size={18} />,
          run: () => useUi.getState().set({ editingId: item.id, flyout: null }),
        },
        ...(item.url
          ? [{
              key: 'open', label: 'Open', glyph: <ExternalLink {...ICON_PROPS} size={18} />,
              run: () => window.open(item.url, '_blank', 'noopener,noreferrer'),
            }]
          : []),
        del,
      ];
    case 'column':
      return [
        color,
        {
          key: 'strip', label: 'Strip', panel: 'strip',
          // A card with a band across the top: the strip colour, or hatched when there's none yet.
          glyph: (
            <span className="glyph-strip" data-empty={!item.strip || undefined} style={{ '--strip': item.strip ?? 'transparent' } as CSSProperties}>
              <i />
            </span>
          ),
        },
        {
          key: 'rename', label: 'Rename', glyph: <PenLine {...ICON_PROPS} size={18} />,
          // Columns rename inline, in their header.
          run: () => useUi.getState().set({ editingId: item.id, flyout: null }),
        },
        {
          key: 'direction',
          label: item.direction === 'horizontal' ? 'Horizontal' : 'Vertical',
          glyph: item.direction === 'horizontal' ? <Columns3 {...ICON_PROPS} size={18} /> : <Rows3 {...ICON_PROPS} size={18} />,
          run: () => update(item.id, { direction: item.direction === 'horizontal' ? 'vertical' : 'horizontal' }),
        },
        del,
      ];
    case 'board': {
      if (item.linkTo) {
        const target = item.linkTo;
        return [
          { key: 'open', label: 'Open', glyph: <ArrowUpRight {...ICON_PROPS} size={18} />, run: () => enterBoard(target) },
          {
            key: 'delete', label: 'Remove', danger: true, glyph: <Trash2 {...ICON_PROPS} size={18} />,
            run: () => confirmDelete(item.id),
          },
        ];
      }
      const actions: ItemAction[] = [
        color,
        { key: 'icon', label: 'Icon', panel: 'icon', glyph: <BoardIcon icon={effectiveIcon(item)} color={item.color} size={14} className="glyph-board" /> },
        isOpenBoard
          // The board you're inside has no tile on screen: rename in a pop-up.
          ? { key: 'rename', label: 'Rename', panel: 'rename', glyph: <PenLine {...ICON_PROPS} size={18} /> }
          : {
              key: 'rename', label: 'Rename', glyph: <PenLine {...ICON_PROPS} size={18} />,
              run: () => useUi.getState().set({ editingId: item.id, flyout: null }),
            },
      ];
      if (!isOpenBoard) {
        actions.push({ key: 'open', label: 'Open', glyph: <ArrowUpRight {...ICON_PROPS} size={18} />, run: () => enterBoard(item.id) });
        actions.push(del);
      }
      return actions;
    }
  }
}

import type { LayoutResult } from '@reprise/layout';
import { CopyIcon, EllipsisIcon, FocusIcon, GaugeIcon, RepeatIcon } from 'lucide-react';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import { claimEscape } from '@/components/ui/tooltip-escape';
import {
  pressedOf,
  scoreKeyboardRequest,
  useEffectPanelState,
  usePickerOpener,
} from '@/features/editor';
import type { ScoreOverlays, ScoreViewHandle } from '@/features/score';
import { selectRunning } from '@/state/playback';

import { keepFocus } from '../command-control';
import { CommandTooltip } from '../command-tooltip';
import { useMenuRegistry } from '../context-menu/menu-context';
import type { MenuContext, MenuRequest } from '../context-menu/types';
import { useContextMenu } from '../context-menu/use-context-menu';
import { useAppServices } from '../services-context';
import {
  bindCommand,
  CommandSourceContext,
  useCommandSource,
  type CommandSource,
} from '../use-command';
import { PILL_BUTTON_SELECTOR } from './commands';
import { DurationMenu } from './duration-menu';
import { editAnchor, lineAbove, pillAnchor } from './pill-anchor';
import {
  EDIT_PILL,
  EDIT_PILL_ONLY,
  loopPressed,
  PLAY_PILL,
  resolvePillItems,
  type PillItemSpec,
  type ResolvedPillItem,
} from './pill-items';
import { placePill, type PillPart } from './place-pill';

const ICONS: Readonly<Record<string, ReactNode>> = {
  loop: <RepeatIcon aria-hidden="true" />,
  trainer: <GaugeIcon aria-hidden="true" />,
  focus: <FocusIcon aria-hidden="true" />,
  copy: <CopyIcon aria-hidden="true" />,
};

const MORE_KEY = 'more';

// A pressed toggle fills, a mixed one is dashed and half filled: the effects panel's look, since
// the ghost button styles nothing for aria-pressed.
const PRESSED_CLASS =
  'rounded-full aria-pressed:bg-muted aria-[pressed=mixed]:border-dashed aria-[pressed=mixed]:border-border aria-[pressed=mixed]:bg-muted/50';

// The pill is a sibling of the score's gesture surface inside the canvas: a press on it must
// never reach the gesture tracker, which would seek, clear the selection or capture the pointer.
const stop = (event: PointerEvent) => {
  event.stopPropagation();
};

interface PillButtonProps {
  source: CommandSource;
  spec: PillItemSpec;
  label: string;
  enabled: boolean;
  pressed: boolean | 'mixed' | undefined;
  tabStop: boolean;
  /** Why the button is disabled, which its tooltip says and assistive tech reads. */
  reason?: string | undefined;
  /** Replaces running the command: a dialog opener. */
  onPress?: ((event: MouseEvent<HTMLButtonElement>) => void) | undefined;
}

function PillButton({
  source,
  spec,
  label,
  enabled,
  pressed,
  tabStop,
  reason,
  onPress,
}: PillButtonProps) {
  const commandId = pressed === true && spec.pressedCommand ? spec.pressedCommand : spec.command;
  const bound = bindCommand(source, commandId);
  return (
    // CommandTooltip wraps a disabled button in a span, which can take the hover to say why.
    <CommandTooltip command={commandId} label={label} reason={reason}>
      <Button
        variant="ghost"
        size="xs"
        className={PRESSED_CLASS}
        aria-label={label}
        aria-pressed={pressed}
        aria-haspopup={onPress ? 'dialog' : undefined}
        data-pill-item={spec.key}
        data-command={spec.command}
        tabIndex={tabStop ? 0 : -1}
        disabled={!enabled}
        onMouseDown={keepFocus}
        onClick={onPress ?? bound.run}
      >
        {ICONS[spec.key]}
        {spec.text}
      </Button>
    </CommandTooltip>
  );
}

export interface SelectionPillProps {
  /** The score view, for the window and the menu's anchor. */
  view: RefObject<ScoreViewHandle | null>;
  layout: LayoutResult;
  zoom: number;
  /** A drag over the score is unfinished. */
  dragging: boolean;
  /** The edit caret and range boxes (layout px), which anchor the pill in edit mode. */
  edit: Pick<ScoreOverlays, 'caret' | 'range'>;
}

/**
 * The toolbar over a bar selection (#339): Loop, Trainer, Focus and Copy beside a menu button,
 * each a view of an item of the range's context menu. It lives in the score's zoomed canvas, so
 * it scrolls with the score for free; its position is written to `transform` when the anchor
 * changes and when the view settles (a scroll's end, zoom, resize, a new layout), never from React
 * state, so nothing renders again for a scroll or a playhead frame. It never takes focus by
 * itself: Tab from the score, or Alt+F10, goes in.
 */
export function SelectionPill({ view, layout, zoom, dragging, edit }: SelectionPillProps) {
  const services = useAppServices();
  const { document, playback, selection, editing, entry, contextMenu, settings } = services;
  const { menus, registry, keyboard } = useMenuRegistry();
  const source = useCommandSource(registry, keyboard, settings, editing);
  const score = useStore(document, (state) => state.score);
  const bars = useStore(selection, (state) => state.bars);
  const cursor = useStore(selection, (state) => state.cursor);
  const range = useStore(selection, (state) => state.range);
  const rhythm = useStore(entry, (state) => state.rhythm);
  const openBend = usePickerOpener('bend');
  const loop = useStore(playback, (state) => state.settings.loop);
  const running = useStore(playback, selectRunning);
  const isEditing = useStore(editing, (state) => state.editing);
  const typing = useStore(
    entry,
    (state) => state.word !== undefined || state.pending !== undefined,
  );
  // What the `when`s of the menu items read, so Focus drops out in practice mode by itself.
  const practising = useStore(services.ui, (state) => state.practiceMode.on);
  const menuOpen = useStore(contextMenu, (state) => state.open);
  const menuRequest = useStore(contextMenu, (state) => state.request);
  const root = useRef<HTMLDivElement>(null);
  /** The request of the menu this pill opened, so a menu opened elsewhere can hide it. */
  const [own, setOwn] = useState<{ request: MenuRequest; via: 'more' | 'context' }>();
  const size = useRef({ width: 0, height: 0 });
  const [current, setCurrent] = useState<string>();
  const returnTo = useRef<Element | null>(null);
  const focusInside = useRef(false);

  const ownMenu = menuOpen && menuRequest === own?.request;
  const foreignMenu = menuOpen && !ownMenu;

  const parts = useMemo((): PillPart[] => {
    if (!score) return [];
    const anchors = isEditing
      ? editAnchor(layout, edit, cursor?.track)
      : bars
        ? pillAnchor(layout, score, bars)
        : [];
    return anchors.map((part) => ({ box: part.box, above: lineAbove(layout, part) }));
  }, [layout, score, bars, isEditing, edit, cursor?.track]);
  const hidden = !score || parts.length === 0 || running || dragging || foreignMenu || typing;
  // Only the shown edit pill pays for the effect state: 4 toggles and the bend blocker.
  const effects = useEffectPanelState(EDIT_PILL_ONLY, isEditing && !hidden);

  const mode = isEditing ? 'edit' : 'play';
  // What the keys' Menu key would open here: its label names the toolbar, its target feeds the items.
  const base = useMemo(
    () =>
      score && parts.length > 0
        ? scoreKeyboardRequest(services, layout, () => new DOMRect(), mode)
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the cursor and the range are the selection the request reads
    [services, layout, score, parts, mode, cursor, range, bars],
  );

  const place = useEffectEvent(() => {
    const element = root.current;
    const handle = view.current;
    if (!element || !handle || element.hidden) return;
    if (size.current.width === 0) {
      size.current = { width: element.offsetWidth, height: element.offsetHeight };
    }
    const window = handle.viewport();
    const scale = (rect: { x: number; y: number; width: number; height: number }) => ({
      x: rect.x * zoom,
      y: rect.y * zoom,
      width: rect.width * zoom,
      height: rect.height * zoom,
    });
    const placed = placePill({
      parts: parts.map(({ box, above }) => ({
        box: scale(box),
        above: above && scale(above),
      })),
      size: size.current,
      visible: scale(window),
    });
    // Scrolled away: hidden from sight and from Tab, unless focus is in it.
    if (!placed) {
      if (!element.contains(globalThis.document.activeElement)) delete element.dataset['placed'];
      return;
    }
    element.style.transform = `translate(${String(placed.x)}px, ${String(placed.y)}px)`;
    element.dataset['side'] = placed.side;
    element.dataset['placed'] = '';
  });

  // The anchor, the shown state: the view's own geometry for zoom, resize and a new layout comes
  // through `subscribeViewport`, after the handle was rebuilt for it.
  useLayoutEffect(() => {
    place();
  }, [parts, zoom, hidden]);

  // Passive: the view's handle is attached after its children's layout effects.
  useEffect(() => {
    const handle = view.current;
    const element = root.current;
    if (!handle || !element) return;
    const off = handle.subscribeViewport(() => {
      place();
    });
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        size.current = { width: element.offsetWidth, height: element.offsetHeight };
        place();
      });
      observer.observe(element);
    }
    place();
    return () => {
      off();
      observer?.disconnect();
    };
  }, [view]);

  // Focus inside a pill that goes away would fall to the body: it goes to the score instead.
  useLayoutEffect(() => {
    if (!hidden || !focusInside.current) return;
    focusInside.current = false;
    const active = globalThis.document.activeElement;
    if (!active || active === globalThis.document.body || root.current?.contains(active)) {
      root.current?.closest<HTMLElement>('[data-score-view]')?.focus();
    }
  }, [hidden]);

  // Items come and go with the mode (Copy leaves, the effects arrive): focus on one that goes
  // would fall to the body, so it goes to the score.
  useLayoutEffect(() => {
    if (!focusInside.current) return;
    focusInside.current = false;
    root.current?.closest<HTMLElement>('[data-score-view]')?.focus();
  }, [mode]);

  // The focused item can become disabled under the user (the cursor moved to a string with nothing
  // to hammer to): focus goes to the nearest enabled item, never to the body.
  useLayoutEffect(() => {
    const element = root.current;
    if (!element || !focusInside.current || hidden) return;
    const active = globalThis.document.activeElement;
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('button[data-pill-item]')];
    const at = buttons.findIndex((button) => button === active);
    if (at < 0 || !buttons[at]?.disabled) return;
    const order = buttons
      .map((_, index) => index)
      .sort((a, b) => Math.abs(a - at) - Math.abs(b - at));
    buttons[order.find((index) => buttons[index]?.disabled === false) ?? -1]?.focus();
  });

  const at = useMemo(
    (): MenuContext => ({ services, target: base?.target ?? { kind: 'range' }, mode }),
    [services, base, mode],
  );
  const pill = isEditing ? EDIT_PILL : PLAY_PILL;
  const resolved = hidden ? [] : resolvePillItems(menus, registry, pill, at, keyboard);
  // An effect the selection cannot take is disabled, with the reason the effects panel gives.
  const items = resolved.map((item) => {
    const { effect, picker, kind } = item.spec;
    const known = effect ? effects.known.get(effect) : undefined;
    const blocked = picker ? effects.blockers[picker] : undefined;
    return {
      ...item,
      enabled:
        item.enabled &&
        (kind === 'effect' ? known !== undefined && known.state !== 'unavailable' : true) &&
        (kind === 'picker' ? blocked === undefined : true),
      reason: known?.reason ?? blocked,
    };
  });
  const enabledKeys = [
    ...items.filter((item) => item.enabled).map((item) => item.spec.key),
    MORE_KEY,
  ];
  const stopKey = current && enabledKeys.includes(current) ? current : enabledKeys[0];

  const pressedFor = (item: ResolvedPillItem): boolean | 'mixed' | undefined => {
    const { key, kind, effect } = item.spec;
    if (key === 'loop') return loopPressed(loop, bars);
    if (key === 'dot') return rhythm.dots > 0;
    if (key === 'triplet') return rhythm.tuplet !== undefined;
    if (kind === 'effect' && effect)
      return pressedOf(effects.known.get(effect)?.state ?? 'unavailable');
    return undefined;
  };

  const request = (via: 'more' | 'context') => {
    const handle = view.current;
    if (!handle) return undefined;
    const made = scoreKeyboardRequest(services, layout, (rect) => handle.clientRect(rect), mode);
    if (made) setOwn({ request: made, via });
    return made;
  };
  const menu = useContextMenu(() => request('context'));

  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const made = request('more');
    if (!made || !contextMenu.getState().hasItems(made)) return;
    const rect = event.currentTarget.getBoundingClientRect();
    // A key press on the button is a keyboard open: focus comes back to it, not to the score.
    contextMenu
      .getState()
      .show(made, event.detail === 0 ? 'keyboard' : 'pointer', { x: rect.left, y: rect.bottom });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const element = root.current;
    // A menu portaled out of the pill (Duration) still bubbles its keys here through React: they are its own.
    if (!element || !(event.target instanceof Node) || !element.contains(event.target)) return;
    if (event.key === 'Escape') {
      // Not the editor's Escape (clear the selection) or practice mode's (leave the mode).
      event.preventDefault();
      claimEscape(event.nativeEvent);
      const back = returnTo.current;
      if (back?.isConnected && !element.contains(back) && back instanceof HTMLElement) {
        back.focus();
      } else {
        element.closest<HTMLElement>('[data-score-view]')?.focus();
      }
      return;
    }
    // The editor's own vertical arrows would move the cursor, and with it the toolbar's items.
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      return;
    }
    const buttons = [...element.querySelectorAll<HTMLElement>(PILL_BUTTON_SELECTOR)];
    const from = buttons.findIndex((button) => button === event.target);
    if (from < 0) return;
    const last = buttons.length - 1;
    const to =
      event.key === 'ArrowRight'
        ? (from + 1) % buttons.length
        : event.key === 'ArrowLeft'
          ? (from + last) % buttons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    if (to === undefined) return;
    // The editor's own arrows must not also move the cursor.
    event.preventDefault();
    buttons[to]?.focus();
  };

  const label = base?.label ?? 'Selection';

  return (
    <div
      ref={root}
      role="toolbar"
      aria-orientation="horizontal"
      aria-label={label}
      className="score-pill"
      data-selection-pill=""
      data-practice={practising || undefined}
      hidden={hidden}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={menu.onContextMenu}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        // A portaled menu's focus bubbles here through React: it is not the toolbar's.
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        focusInside.current = true;
        const related = event.relatedTarget;
        // A closed menu's item is no place to go back to.
        if (
          related instanceof Element &&
          !event.currentTarget.contains(related) &&
          !related.closest('[role="menu"]')
        ) {
          returnTo.current = related;
        }
        if (event.target instanceof HTMLElement) {
          setCurrent(event.target.dataset['pillItem'] ?? MORE_KEY);
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !event.currentTarget.contains(next)) {
          focusInside.current = false;
        }
      }}
    >
      {/* The score is outside the app's command contexts: the Duration steps need the source. */}
      <CommandSourceContext value={source}>
        {items.map((item) =>
          item.spec.kind === 'duration' ? (
            <DurationMenu
              key={item.spec.key}
              itemKey={item.spec.key}
              enabled={item.enabled}
              tabStop={stopKey === item.spec.key}
            />
          ) : (
            <PillButton
              source={source}
              key={item.spec.key}
              spec={item.spec}
              label={item.label}
              enabled={item.enabled}
              pressed={pressedFor(item)}
              tabStop={stopKey === item.spec.key}
              reason={item.enabled ? undefined : item.reason}
              onPress={item.spec.kind === 'picker' ? openBend : undefined}
            />
          ),
        )}
        <span role="separator" aria-orientation="vertical" className="score-pill-separator" />
        <Button
          variant="ghost"
          size="icon-xs"
          className="rounded-full"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={ownMenu && own?.via === 'more'}
          data-pill-item={MORE_KEY}
          tabIndex={stopKey === MORE_KEY ? 0 : -1}
          onMouseDown={keepFocus}
          onClick={openMenu}
        >
          <EllipsisIcon aria-hidden="true" />
        </Button>
      </CommandSourceContext>
    </div>
  );
}

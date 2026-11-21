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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { barsLabel, scoreKeyboardRequest } from '@/features/editor';
import type { ScoreViewHandle } from '@/features/score';
import { selectRunning } from '@/state/playback';

import { keepFocus, tooltipText } from '../command-control';
import { useMenuRegistry } from '../context-menu/menu-context';
import type { MenuContext, MenuRequest } from '../context-menu/types';
import { useContextMenu } from '../context-menu/use-context-menu';
import { useAppServices } from '../services-context';
import { bindCommand, useCommandSource, type CommandSource } from '../use-command';
import { PILL_BUTTON_SELECTOR } from './commands';
import { lineAbove, pillAnchor } from './pill-anchor';
import {
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
  pressed: boolean | undefined;
  tabStop: boolean;
}

function PillButton({ source, spec, label, enabled, pressed, tabStop }: PillButtonProps) {
  const bound = bindCommand(
    source,
    pressed && spec.pressedCommand ? spec.pressedCommand : spec.command,
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="rounded-full"
          aria-label={label}
          aria-pressed={pressed}
          aria-keyshortcuts={bound.ariaKeys}
          data-pill-item={spec.key}
          data-command={spec.command}
          tabIndex={tabStop ? 0 : -1}
          disabled={!enabled}
          onMouseDown={keepFocus}
          onClick={bound.run}
        >
          {ICONS[spec.key]}
          {spec.text}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText(label, bound.keys)}</TooltipContent>
    </Tooltip>
  );
}

export interface SelectionPillProps {
  /** The score view, for the window and the menu's anchor. */
  view: RefObject<ScoreViewHandle | null>;
  layout: LayoutResult;
  zoom: number;
  /** A drag over the score is unfinished. */
  dragging: boolean;
}

/**
 * The toolbar over a bar selection (#339): Loop, Trainer, Focus and Copy beside a menu button,
 * each a view of an item of the range's context menu. It lives in the score's zoomed canvas, so
 * it scrolls with the score for free; its position is written to `transform` when the anchor
 * changes and when the view settles (a scroll's end, zoom, resize, a new layout), never from React
 * state, so nothing renders again for a scroll or a playhead frame. It never takes focus by
 * itself: Tab from the score, or Alt+F10, goes in.
 */
export function SelectionPill({ view, layout, zoom, dragging }: SelectionPillProps) {
  const services = useAppServices();
  const { document, playback, selection, editing, entry, contextMenu, settings } = services;
  const { menus, registry, keyboard } = useMenuRegistry();
  const source = useCommandSource(registry, keyboard, settings);
  const score = useStore(document, (state) => state.score);
  const bars = useStore(selection, (state) => state.bars);
  const loop = useStore(playback, (state) => state.settings.loop);
  const running = useStore(playback, selectRunning);
  const isEditing = useStore(editing, (state) => state.editing);
  const typing = useStore(
    entry,
    (state) => state.word !== undefined || state.pending !== undefined,
  );
  const menuOpen = useStore(contextMenu, (state) => state.open);
  const menuRequest = useStore(contextMenu, (state) => state.request);
  const root = useRef<HTMLDivElement>(null);
  /** The request of the menu this pill opened, so a menu opened elsewhere can hide it. */
  const [own, setOwn] = useState<MenuRequest>();
  const size = useRef({ width: 0, height: 0 });
  const [current, setCurrent] = useState<string>();
  const returnTo = useRef<Element | null>(null);
  const focusInside = useRef(false);

  const ownMenu = menuOpen && menuRequest === own;
  const foreignMenu = menuOpen && !ownMenu;
  const hidden = !score || !bars || isEditing || running || dragging || foreignMenu || typing;

  const parts = useMemo((): PillPart[] => {
    if (!score || !bars) return [];
    return pillAnchor(layout, score, bars).map((part) => ({
      box: part.box,
      above: lineAbove(layout, part),
    }));
  }, [layout, score, bars]);

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

  const at = useMemo(
    (): MenuContext => ({ services, target: { kind: 'range' }, mode: 'play' }),
    [services],
  );
  const items = hidden ? [] : resolvePillItems(menus, registry, PLAY_PILL, at, keyboard);
  const enabledKeys = [
    ...items.filter((item) => item.enabled).map((item) => item.spec.key),
    MORE_KEY,
  ];
  const stopKey = current && enabledKeys.includes(current) ? current : enabledKeys[0];

  const pressedOf = (item: ResolvedPillItem): boolean | undefined =>
    item.spec.key === 'loop' ? loopPressed(loop, bars) : undefined;

  const request = () => {
    const handle = view.current;
    if (!handle) return undefined;
    const made = scoreKeyboardRequest(services, layout, (rect) => handle.clientRect(rect), 'play');
    setOwn(made);
    return made;
  };
  const menu = useContextMenu(() => request());

  const openMenu = (event: MouseEvent<HTMLButtonElement>) => {
    const made = request();
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
    if (!element) return;
    if (event.key === 'Escape') {
      // Not the editor's Escape (clear the selection) or practice mode's (leave the mode).
      event.preventDefault();
      const back = returnTo.current;
      if (back?.isConnected && !element.contains(back) && back instanceof HTMLElement) {
        back.focus();
      } else {
        element.closest<HTMLElement>('[data-score-view]')?.focus();
      }
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

  if (isEditing) return null;
  const label = score && bars ? barsLabel(score, bars) : 'Selection';

  return (
    <div
      ref={root}
      role="toolbar"
      aria-orientation="horizontal"
      aria-label={label}
      className="score-pill"
      data-selection-pill=""
      hidden={hidden}
      onPointerDown={stop}
      onPointerMove={stop}
      onPointerUp={stop}
      onPointerCancel={stop}
      onContextMenu={menu.onContextMenu}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        focusInside.current = true;
        const related = event.relatedTarget;
        if (related instanceof Element && !event.currentTarget.contains(related)) {
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
      {items.map((item) => (
        <PillButton
          source={source}
          key={item.spec.key}
          spec={item.spec}
          label={item.label}
          enabled={item.enabled}
          pressed={pressedOf(item)}
          tabStop={stopKey === item.spec.key}
        />
      ))}
      <span role="separator" aria-orientation="vertical" className="score-pill-separator" />
      <Button
        variant="ghost"
        size="icon-xs"
        className="rounded-full"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={ownMenu}
        data-pill-item={MORE_KEY}
        tabIndex={stopKey === MORE_KEY ? 0 : -1}
        onMouseDown={keepFocus}
        onClick={openMenu}
      >
        <EllipsisIcon aria-hidden="true" />
      </Button>
    </div>
  );
}

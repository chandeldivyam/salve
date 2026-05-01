import type { ReactNode } from 'react';

export type WorkbenchRouteKind = 'app' | 'record' | 'utility';

export type WorkbenchTabOpenSource =
  | 'tab_click'
  | 'link_click'
  | 'modified_link_click'
  | 'middle_click'
  | 'close_button'
  | 'context_menu'
  | 'duplicate'
  | 'keyboard'
  | (string & {});

export interface WorkbenchTab {
  id: string;
  routeId: string;
  tabKey: string;
  href: string;
  title: string;
  customTitle?: string;
  iconId: string;
  pinned: boolean;
  workspaceID: string;
  lastActiveAt: number;
  closable?: boolean;
  badge?: boolean;
}

export interface WorkbenchRouteDef {
  id: string;
  kind: WorkbenchRouteKind;
  iconId: string;
  title: string;
}

export interface WorkbenchTabCloseOptions {
  source?: WorkbenchTabOpenSource;
}

export interface WorkbenchTabActions {
  openOrReuseTab(workspaceID: string, href: string, source: WorkbenchTabOpenSource): void;
  forkTab(workspaceID: string, href: string, source?: WorkbenchTabOpenSource): void;
  activateTab(workspaceID: string, tabId: string): void;
  closeTab(workspaceID: string, tabId: string, options?: WorkbenchTabCloseOptions): void;
  closeLeft(workspaceID: string, tabId: string): void;
  closeRight(workspaceID: string, tabId: string): void;
  duplicateTab(workspaceID: string, tabId: string): void;
  renameTab(workspaceID: string, tabId: string, title: string): void;
  pinTab(workspaceID: string, tabId: string): void;
  unpinTab(workspaceID: string, tabId: string): void;
  reorderTabs(workspaceID: string, activeId: string, overId: string): void;
}

export type WorkbenchTabIconRenderer = (iconId: string, tab: WorkbenchTab) => ReactNode;

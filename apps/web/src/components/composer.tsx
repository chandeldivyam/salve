// Phase 2c — Plain.com-style composer. Tiptap editor (StarterKit + Link)
// with a thin toolbar at top and a Send button at right. Supports drag/drop
// or click-to-pick attachments which upload directly to S3 via the
// /api/files/presign endpoint.
//
// Submit shape (passed to `onSend`):
//   {
//     bodyHTML, bodyText, isInternal,
//     attachments: [{ id, s3Key, filename, mimeType, sizeBytes }]
//   }
// The caller wires `onSend` to `mutators.message.send` with a generated
// message id.

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@opendesk/ui';
import { useRouteContext } from '@tanstack/react-router';
import Link from '@tiptap/extension-link';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  Bold,
  Check,
  ChevronDown,
  Code,
  Italic,
  Link2,
  List,
  ListOrdered,
  Lock,
  MailCheck,
  MessageSquare,
  Paperclip,
  Quote,
  Send,
  Signature,
  Underline as UnderlineIcon,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeyBinding } from '@/lib/commands/use-key-binding';
import { useComposerDraftsStore } from '@/lib/composer-drafts';
import type { SessionData } from '@/lib/session-loader';

export interface ComposerAttachment {
  id: string;
  s3Key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ComposerEmailAddress {
  id: string;
  fullAddress: string;
  label?: string | null;
  isDefault?: boolean | null;
  signatureHTML?: string | null;
  signatureHtml?: string | null;
  signature?: string | null;
  sendingDomain?: {
    id?: string;
    domain?: string | null;
    dnsStatus?: string | null;
  } | null;
}

export interface ComposerSendArgs {
  bodyHTML: string;
  bodyText: string;
  isInternal: boolean;
  emailAddressID?: string;
  attachments: ComposerAttachment[];
}

interface ComposerProps {
  ticketID: string;
  userID?: string;
  workspaceID?: string | null;
  disabled?: boolean;
  disabledReason?: string;
  emailAddresses?: ComposerEmailAddress[];
  preferredEmailAddressID?: string | null;
  onSend: (args: ComposerSendArgs) => Promise<void> | void;
}

interface PendingUpload {
  localID: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'uploading' | 'done' | 'error';
  s3Key?: string;
  error?: string;
}

interface DraftBodySnapshot {
  bodyHTML: string;
  bodyText: string;
}

const apiBase = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
const EMPTY_DRAFT_BODY: DraftBodySnapshot = { bodyHTML: '', bodyText: '' };

async function presignFile(file: File, ticketID: string) {
  const res = await fetch(`${apiBase}/api/files/presign`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      ticketID,
    }),
  });
  if (!res.ok) throw new Error(`presign failed: ${res.status}`);
  return (await res.json()) as { s3Key: string; putUrl: string };
}

async function uploadToS3(putUrl: string, file: File) {
  const res = await fetch(putUrl, {
    method: 'PUT',
    body: file,
    headers: { 'content-type': file.type || 'application/octet-stream' },
  });
  if (!res.ok) throw new Error(`s3 upload failed: ${res.status}`);
}

export function Composer({
  ticketID,
  userID: userIDProp,
  workspaceID: workspaceIDProp,
  disabled,
  disabledReason,
  emailAddresses = [],
  preferredEmailAddressID,
  onSend,
}: ComposerProps) {
  const { session } = useRouteContext({ from: '/app' }) as { session: SessionData };
  const userID = userIDProp ?? session.user.id;
  const workspaceID = workspaceIDProp ?? session.session.activeOrganizationId ?? null;
  const draftKey = workspaceID ? `${workspaceID}:${ticketID}` : null;
  const initializeDrafts = useComposerDraftsStore((state) => state.initializeDrafts);
  const getDraft = useComposerDraftsStore((state) => state.getDraft);
  const setDraft = useComposerDraftsStore((state) => state.setDraft);
  const clearDraft = useComposerDraftsStore((state) => state.clearDraft);
  const [tab, setTab] = useState<'reply' | 'note'>('reply');
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [sending, setSending] = useState(false);
  const [selectedEmailAddressID, setSelectedEmailAddressID] = useState<string | null>(null);
  const [bodySnapshot, setBodySnapshot] = useState<DraftBodySnapshot>(EMPTY_DRAFT_BODY);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropRef = useRef<HTMLDivElement | null>(null);
  const draftDirtyRef = useRef(false);
  const suppressNextEditorUpdateRef = useRef(false);
  const latestDraftRef = useRef({
    bodySnapshot,
    isInternal: tab === 'note',
    selectedEmailAddressID,
  });

  const preferredEmailAddress =
    (preferredEmailAddressID
      ? emailAddresses.find((address) => address.id === preferredEmailAddressID)
      : null) ?? null;
  const fallbackEmailAddress =
    emailAddresses.find((address) => address.isDefault) ?? emailAddresses[0] ?? null;
  const defaultEmailAddress = preferredEmailAddress ?? fallbackEmailAddress;
  const selectedEmailAddress =
    emailAddresses.find((address) => address.id === selectedEmailAddressID) ?? defaultEmailAddress;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        codeBlock: false,
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none focus:outline-none min-h-[100px] px-4 py-3 text-[13.5px] text-surface-foreground leading-relaxed',
      },
    },
  });

  useEffect(() => {
    latestDraftRef.current = {
      bodySnapshot,
      isInternal: tab === 'note',
      selectedEmailAddressID,
    };
  }, [bodySnapshot, selectedEmailAddressID, tab]);

  const markDraftDirty = useCallback(() => {
    draftDirtyRef.current = true;
  }, []);

  const selectTab = useCallback(
    (next: 'reply' | 'note') => {
      if (tab !== next) markDraftDirty();
      setTab(next);
    },
    [markDraftDirty, tab],
  );

  const selectEmailAddress = useCallback(
    (id: string) => {
      setSelectedEmailAddressID(id);
      markDraftDirty();
    },
    [markDraftDirty],
  );

  useEffect(() => {
    initializeDrafts(userID);
  }, [initializeDrafts, userID]);

  // Restore the per-ticket draft on mount/reload and when switching tickets.
  useEffect(() => {
    if (!editor) return;

    const draft = getDraft(workspaceID, ticketID);
    if (draft?.bodyHTML) {
      editor.commands.setContent(draft.bodyHTML, false);
    } else {
      editor.commands.clearContent(false);
    }

    setBodySnapshot(
      draft ? { bodyHTML: draft.bodyHTML, bodyText: draft.bodyText } : EMPTY_DRAFT_BODY,
    );
    setTab(draft?.isInternal ? 'note' : 'reply');
    setSelectedEmailAddressID(draft?.selectedAddressID ?? null);
    setUploads([]);
    draftDirtyRef.current = false;
    suppressNextEditorUpdateRef.current = false;
  }, [editor, getDraft, ticketID, workspaceID]);

  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      setBodySnapshot({
        bodyHTML: editor.getHTML(),
        bodyText: editor.getText(),
      });
      if (suppressNextEditorUpdateRef.current) {
        suppressNextEditorUpdateRef.current = false;
        return;
      }
      markDraftDirty();
    };

    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
    };
  }, [editor, markDraftDirty]);

  useEffect(() => {
    if (!userID || !draftKey || !draftDirtyRef.current) return;

    const timeoutID = window.setTimeout(() => {
      setDraft(workspaceID, ticketID, {
        bodyHTML: bodySnapshot.bodyHTML,
        bodyText: bodySnapshot.bodyText,
        isInternal: tab === 'note',
        ...(selectedEmailAddressID ? { selectedAddressID: selectedEmailAddressID } : {}),
        updatedAt: Date.now(),
      });
    }, 300);

    return () => window.clearTimeout(timeoutID);
  }, [
    bodySnapshot,
    draftKey,
    selectedEmailAddressID,
    setDraft,
    tab,
    ticketID,
    userID,
    workspaceID,
  ]);

  useEffect(() => {
    return () => {
      if (!userID || !draftKey || !draftDirtyRef.current) return;
      const latest = latestDraftRef.current;
      setDraft(workspaceID, ticketID, {
        bodyHTML: latest.bodySnapshot.bodyHTML,
        bodyText: latest.bodySnapshot.bodyText,
        isInternal: latest.isInternal,
        ...(latest.selectedEmailAddressID
          ? { selectedAddressID: latest.selectedEmailAddressID }
          : {}),
        updatedAt: Date.now(),
      });
    };
  }, [draftKey, setDraft, ticketID, userID, workspaceID]);

  useEffect(() => {
    if (!emailAddresses.length) {
      setSelectedEmailAddressID(null);
      return;
    }
    setSelectedEmailAddressID((current) =>
      current && emailAddresses.some((address) => address.id === current)
        ? current
        : preferredEmailAddress?.id
          ? preferredEmailAddress.id
          : (fallbackEmailAddress?.id ?? null),
    );
  }, [emailAddresses, fallbackEmailAddress?.id, preferredEmailAddress?.id]);

  const handleFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const localID = crypto.randomUUID();
        setUploads((prev) => [
          ...prev,
          {
            localID,
            filename: file.name,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
            status: 'uploading',
          },
        ]);
        try {
          const { s3Key, putUrl } = await presignFile(file, ticketID);
          await uploadToS3(putUrl, file);
          setUploads((prev) =>
            prev.map((u) => (u.localID === localID ? { ...u, status: 'done', s3Key } : u)),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'upload failed';
          setUploads((prev) =>
            prev.map((u) => (u.localID === localID ? { ...u, status: 'error', error: msg } : u)),
          );
        }
      }
    },
    [ticketID],
  );

  // Drag-and-drop on the composer surface.
  useEffect(() => {
    const el = dropRef.current;
    if (!el) return;
    function onDragOver(ev: DragEvent) {
      ev.preventDefault();
    }
    function onDrop(ev: DragEvent) {
      ev.preventDefault();
      const files = Array.from(ev.dataTransfer?.files ?? []);
      if (files.length) handleFiles(files);
    }
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('drop', onDrop);
    };
  }, [handleFiles]);

  const removeUpload = (localID: string) => {
    setUploads((prev) => prev.filter((u) => u.localID !== localID));
  };

  const onSendClick = useCallback(async () => {
    if (!editor || sending) return;
    const html = editor.getHTML();
    const text = editor.getText();
    if (!text.trim() && uploads.length === 0) return;
    setSending(true);
    try {
      const attachments: ComposerAttachment[] = uploads
        .filter((u) => u.status === 'done' && u.s3Key)
        .map((u) => ({
          id: crypto.randomUUID(),
          s3Key: u.s3Key as string,
          filename: u.filename,
          mimeType: u.mimeType,
          sizeBytes: u.sizeBytes,
        }));
      await onSend({
        bodyHTML: html,
        bodyText: text,
        isInternal: tab === 'note',
        emailAddressID: tab === 'reply' ? (selectedEmailAddress?.id ?? undefined) : undefined,
        attachments,
      });
      clearDraft(workspaceID, ticketID);
      draftDirtyRef.current = false;
      suppressNextEditorUpdateRef.current = true;
      editor.commands.clearContent(true);
      setBodySnapshot(EMPTY_DRAFT_BODY);
      setUploads([]);
    } finally {
      setSending(false);
    }
  }, [
    clearDraft,
    editor,
    sending,
    tab,
    ticketID,
    uploads,
    onSend,
    selectedEmailAddress,
    workspaceID,
  ]);

  useKeyBinding(
    '$mod+Enter',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.tiptap-composer')) return;
      event.preventDefault();
      onSendClick();
    },
    { scopes: ['conversation'], allowInInputs: true, preventDefault: false },
  );

  if (disabled) {
    return (
      <div className="m-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
        <Lock className="mr-2 inline h-3.5 w-3.5 text-muted-foreground" />
        {disabledReason ?? 'Composer disabled.'}
      </div>
    );
  }

  return (
    <div
      ref={dropRef}
      className={cn(
        'tiptap-composer m-4 flex flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm',
        tab === 'note' && 'border-warning-border bg-warning-soft/40',
      )}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-2">
        <TabPill
          active={tab === 'reply'}
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          label="Reply"
          onClick={() => selectTab('reply')}
        />
        <TabPill
          active={tab === 'note'}
          icon={<Lock className="h-3.5 w-3.5" />}
          label="Internal note"
          tone="amber"
          onClick={() => selectTab('note')}
        />
        {tab === 'reply' ? (
          <FromPicker
            addresses={emailAddresses}
            selected={selectedEmailAddress}
            preferredEmailAddressID={preferredEmailAddressID}
            onSelect={selectEmailAddress}
          />
        ) : null}
        <span className="mx-2 h-5 w-px bg-border" />
        <ToolbarButton
          aria-label="Bold"
          active={editor?.isActive('bold') ?? false}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Italic"
          active={editor?.isActive('italic') ?? false}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Underline (StarterKit doesn't ship Underline; this falls back to italic on toggle)"
          active={editor?.isActive('underline') ?? false}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <UnderlineIcon className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Inline code"
          active={editor?.isActive('code') ?? false}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        >
          <Code className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Link"
          active={editor?.isActive('link') ?? false}
          onClick={() => {
            const previous = editor?.getAttributes('link').href as string | undefined;
            const url = window.prompt('Link URL', previous ?? 'https://');
            if (url === null) return;
            if (url === '') {
              editor?.chain().focus().unsetLink().run();
            } else {
              editor?.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
            }
          }}
        >
          <Link2 className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Quote"
          active={editor?.isActive('blockquote') ?? false}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Quote className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Bullet list"
          active={editor?.isActive('bulletList') ?? false}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List className="h-3.5 w-3.5" />
        </ToolbarButton>
        <ToolbarButton
          aria-label="Numbered list"
          active={editor?.isActive('orderedList') ?? false}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarButton>
        <span className="mx-2 h-5 w-px bg-border" />
        <ToolbarButton aria-label="Attach" onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="h-3.5 w-3.5" />
        </ToolbarButton>
      </div>

      <EditorContent editor={editor} />

      {uploads.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
          {uploads.map((u) => (
            <span
              key={u.localID}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]',
                u.status === 'uploading' && 'border-border bg-muted text-muted-foreground',
                u.status === 'done' &&
                  'border-success-border bg-success-soft text-success-soft-foreground',
                u.status === 'error' &&
                  'border-danger-border bg-danger-soft text-danger-soft-foreground',
              )}
            >
              <Paperclip className="h-3 w-3" />
              <span className="max-w-[160px] truncate">{u.filename}</span>
              <span className="text-muted-foreground">·</span>
              <span>{formatSize(u.sizeBytes)}</span>
              {u.status === 'uploading' && (
                <span className="text-muted-foreground">uploading…</span>
              )}
              {u.status === 'error' && <span title={u.error}>failed</span>}
              <button
                type="button"
                onClick={() => removeUpload(u.localID)}
                className="ml-1 text-muted-foreground hover:text-foreground"
                aria-label="Remove attachment"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface-muted/60 px-3 py-2">
        <span className="min-w-0 text-[11px] text-muted-foreground">
          {tab === 'note'
            ? 'Visible to your team only'
            : selectedEmailAddress
              ? `Visible to the customer from ${selectedEmailAddress.fullAddress}`
              : 'Visible to the customer'}{' '}
          · ⌘↩ to send
        </span>
        <Button
          size="sm"
          onClick={onSendClick}
          disabled={sending || !editor || (editor.isEmpty && uploads.length === 0)}
        >
          <Send className="h-3.5 w-3.5" />
          {sending ? 'Sending…' : tab === 'note' ? 'Save note' : 'Send reply'}
        </Button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) handleFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function TabPill({
  active,
  icon,
  label,
  onClick,
  tone,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  tone?: 'amber';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active
          ? tone === 'amber'
            ? 'bg-warning-soft text-warning-soft-foreground ring-1 ring-warning-border'
            : 'bg-brand-soft text-brand-soft-foreground ring-1 ring-brand-border'
          : 'text-muted-foreground hover:bg-surface-muted',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function FromPicker({
  addresses,
  selected,
  preferredEmailAddressID,
  onSelect,
}: {
  addresses: ComposerEmailAddress[];
  selected: ComposerEmailAddress | null;
  preferredEmailAddressID?: string | null;
  onSelect: (id: string) => void;
}) {
  if (addresses.length === 0) {
    return (
      <span className="ml-1 inline-flex min-w-0 items-center rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
        No send address
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="ml-1 inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
        >
          <span className="text-muted-foreground">From</span>
          <span className="max-w-[220px] truncate font-medium text-foreground sm:max-w-[260px]">
            {selected?.fullAddress ?? 'Choose address'}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(360px,calc(100vw-2rem))]">
        <DropdownMenuLabel>Send from</DropdownMenuLabel>
        {addresses.map((address) => {
          const domain =
            address.sendingDomain?.domain ?? address.fullAddress.split('@')[1] ?? 'email';
          return (
            <DropdownMenuItem
              key={address.id}
              onSelect={() => onSelect(address.id)}
              className="items-start gap-2"
            >
              <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center">
                {selected?.id === address.id ? <Check className="h-3.5 w-3.5" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">
                  {address.fullAddress}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {address.label ? `${address.label} · ` : ''}
                  {domain}
                  {address.isDefault ? ' · default' : ''}
                  {address.id === preferredEmailAddressID ? ' · inbound' : ''}
                </span>
                {addressSignature(address) ? (
                  <span className="mt-1 inline-flex max-w-full items-center gap-1 text-[11px] text-muted-foreground">
                    <Signature className="h-3 w-3 shrink-0" />
                    <span className="truncate">Signature override</span>
                  </span>
                ) : null}
              </span>
              {address.id === preferredEmailAddressID ? (
                <MailCheck className="mt-1 h-3.5 w-3.5 shrink-0 text-brand-600" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function addressSignature(address: ComposerEmailAddress): string | null {
  return address.signatureHTML ?? address.signatureHtml ?? address.signature ?? null;
}

function ToolbarButton({
  active,
  children,
  onClick,
  ...props
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground',
        active && 'bg-brand-soft text-brand-soft-foreground',
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

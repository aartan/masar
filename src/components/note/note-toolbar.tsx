import * as React from "react";

import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  Code,
  FileCode2,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MoreHorizontal,
  Redo2,
  Strikethrough,
  Table,
  TextQuote,
  Type,
  Underline,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { type BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import {
  useEditorChange,
  useEditorDOMElement,
  useEditorSelectionChange,
} from "@blocknote/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { errorMessage } from "@/lib/client-api";
import { IMAGE_ACCEPT } from "@/lib/image-file";
import { validateNoteLinkUrl } from "@/lib/note-link";
import type { NoteWidth } from "@/lib/use-note-width";
import { cn } from "@/lib/utils";

type BlockStyle =
  | "paragraph"
  | "heading"
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem"
  | "quote"
  | "codeBlock";

type TextStyle = "bold" | "italic" | "underline" | "strike" | "code";

type TextAlignment = "left" | "center" | "right" | "justify";

/** Highlight colors BlockNote's default schema accepts. */
const HIGHLIGHT_COLORS = [
  { value: "default", label: "None" },
  { value: "yellow", label: "Yellow" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "purple", label: "Purple" },
  { value: "pink", label: "Pink" },
] as const;

const SWATCH_CLASSES: Record<string, string> = {
  default: "border border-border bg-transparent",
  yellow: "bg-yellow-300",
  green: "bg-green-300",
  blue: "bg-blue-300",
  purple: "bg-purple-300",
  pink: "bg-pink-300",
};

const TABLE_COLUMNS = 3;
const TABLE_ROWS = 3;

function createTableBlock(): PartialBlock {
  const cell = () => ({
    type: "tableCell",
    props: {
      backgroundColor: "default",
      textColor: "default",
      textAlignment: "left",
      colspan: 1,
      rowspan: 1,
    },
    // Table cells hold inline content (rendered as tableParagraph nodes),
    // not regular blocks.
    content: [{ type: "text", text: "" }],
  });
  return {
    type: "table",
    content: {
      type: "tableContent",
      columnWidths: Array.from({ length: TABLE_COLUMNS }, () => undefined),
      rows: Array.from({ length: TABLE_ROWS }, () => ({
        cells: Array.from({ length: TABLE_COLUMNS }, cell),
      })),
    },
  } as unknown as PartialBlock;
}

/** Whether the editor's history extension can step back/forward. */
function editorHistory(editor: BlockNoteEditor): { undo: boolean; redo: boolean } {
  try {
    const can = editor._tiptapEditor.can() as unknown as {
      undo?: () => boolean;
      redo?: () => boolean;
    };
    return { undo: can.undo?.() ?? true, redo: can.redo?.() ?? true };
  } catch {
    // Fall back to enabled when the capability query is unavailable.
    return { undo: true, redo: true };
  }
}

function NoteToolbarButton({
  label,
  selected = false,
  disabled = false,
  className,
  onClick,
  children,
}: {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const button = (
    <button
      type="button"
      className={cn(
        "masar-note-toolbar-button",
        className,
      )}
      aria-label={label}
      aria-pressed={selected}
      aria-disabled={disabled || undefined}
      data-selected={selected || undefined}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function NoteToolbarGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="masar-note-toolbar-group" role="group" aria-label={label}>
      {children}
    </div>
  );
}

function NoteWidthIcon({ width }: { width: NoteWidth }) {
  const lineWidth = width === "narrow" ? 6 : width === "standard" ? 12 : 18;
  const x = (24 - lineWidth) / 2;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="2.25" />
      <path d={`M${x} 8h${lineWidth}M${x} 12h${lineWidth}M${x} 16h${lineWidth}`} />
    </svg>
  );
}

/** A toolbar menu item with icon, label and optional selected check. */
function NoteMenuItem({
  label,
  selected = false,
  onSelect,
  children,
}: {
  label: string;
  selected?: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect}>
      {children}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected && <Check className="size-3.5 shrink-0 text-muted-foreground" />}
    </DropdownMenuItem>
  );
}

export function NoteFormattingToolbar({
  editor,
  noteWidth,
  onNoteWidthChange,
  uploadFile,
}: {
  editor: BlockNoteEditor;
  noteWidth: NoteWidth;
  onNoteWidthChange: (width: NoteWidth) => void;
  /** Upload one image and resolve its URL (shared with the editor session). */
  uploadFile: (file: File) => Promise<string>;
}) {
  // Re-render on selection and content changes so every control reflects the
  // current cursor state (block type, active styles, undo availability).
  const [, setSelectionVersion] = React.useState(0);
  const [, setContentVersion] = React.useState(0);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkUrl, setLinkUrl] = React.useState("");
  const [linkText, setLinkText] = React.useState("");
  const [linkError, setLinkError] = React.useState<string | null>(null);
  const imageInputRef = React.useRef<HTMLInputElement | null>(null);
  const editorElement = useEditorDOMElement(editor);

  useEditorSelectionChange(
    () => setSelectionVersion((version) => version + 1),
    editor,
  );
  useEditorChange(() => setContentVersion((version) => version + 1), editor);

  const openLinkEditor = React.useCallback(() => {
    setLinkText(editor.getSelectedText());
    setLinkUrl(editor.getSelectedLinkUrl() ?? "");
    setLinkError(null);
    setLinkOpen(true);
  }, [editor]);

  React.useEffect(() => {
    if (!editorElement) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openLinkEditor();
      }
    };
    editorElement.addEventListener("keydown", handleShortcut);
    return () => editorElement.removeEventListener("keydown", handleShortcut);
  }, [editorElement, openLinkEditor]);

  const block = editor.getTextCursorPosition().block;
  const selectedBlocks = editor.getSelection()?.blocks ?? [block];
  const currentType = block.type;
  const activeStyles = editor.getActiveStyles();
  const textAlignment =
    "textAlignment" in block.props ? block.props.textAlignment : undefined;
  const highlightColor =
    "backgroundColor" in activeStyles &&
    typeof activeStyles.backgroundColor === "string" &&
    activeStyles.backgroundColor !== "default"
      ? activeStyles.backgroundColor
      : "default";
  const history = editorHistory(editor);

  const setBlockType = (type: BlockStyle, props?: Record<string, unknown>) => {
    editor.focus();
    const activeBlock = editor.getTextCursorPosition().block;
    editor.updateBlock(activeBlock, {
      type,
      ...(props ? { props } : {}),
    } as PartialBlock);
  };

  const setTextAlignment = (alignment: TextAlignment) => {
    editor.focus();
    for (const selectedBlock of selectedBlocks) {
      if ("textAlignment" in selectedBlock.props) {
        editor.updateBlock(selectedBlock, {
          props: { textAlignment: alignment },
        });
      }
    }
  };

  const toggleStyle = (style: TextStyle) => {
    editor.focus();
    editor.toggleStyles({ [style]: true });
  };

  const toggleHighlight = (color: string = "yellow") => {
    editor.focus();
    editor.toggleStyles({
      backgroundColor: highlightColor === color ? "default" : color,
    });
  };

  const undo = () => {
    editor.focus();
    editor.undo();
  };

  const redo = () => {
    editor.focus();
    editor.redo();
  };

  const insertDivider = () => {
    editor.focus();
    const reference = editor.getTextCursorPosition().block;
    editor.insertBlocks([{ type: "divider" }], reference, "after");
  };

  const insertTable = () => {
    editor.focus();
    const reference = editor.getTextCursorPosition().block;
    const [inserted] = editor.insertBlocks(
      [createTableBlock()],
      reference,
      "after",
    );
    if (!inserted) {
      toast.error("Could not insert a table");
      return;
    }
    editor.setTextCursorPosition(inserted, "end");
    editor.focus();
  };

  const insertImage = async (file: File) => {
    const referenceBlock = editor.getTextCursorPosition().block;
    let url: string;
    try {
      url = await uploadFile(file);
    } catch {
      // uploadFile already reports validation and storage failures.
      return;
    }

    try {
      if (!editor.getBlock(referenceBlock.id)) return;
      const [imageBlock] = editor.insertBlocks(
        [{ type: "image", props: { url } }],
        referenceBlock.id,
        "after",
      );
      if (!imageBlock) {
        throw new Error("BlockNote did not insert the image block");
      }
      editor.focus();
    } catch (error) {
      toast.error("Could not add image", {
        description: errorMessage(error),
      });
    }
  };

  const createLink = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateNoteLinkUrl(linkUrl);
    if (!validation.ok) {
      setLinkError(validation.message);
      return;
    }
    editor.focus();
    if (linkText) {
      editor.createLink(validation.url, linkText);
    } else {
      editor.insertInlineContent([
        { type: "link", href: validation.url, content: validation.url },
      ]);
    }
    setLinkOpen(false);
  };

  const pickImage = () => {
    imageInputRef.current?.click();
  };

  const onImageInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) void insertImage(file);
  };

  const headingButtonClass = "hidden sm:inline-flex";
  const widthButtonClass = "hidden lg:inline-flex";

  return (
    <div className="masar-note-toolbar shrink-0 border-b border-border/60 bg-background/65">
      <div
        className="masar-note-toolbar-scroll"
        role="toolbar"
        aria-label="Note formatting"
        aria-orientation="horizontal"
      >
        <NoteToolbarGroup label="Undo and redo">
          <NoteToolbarButton label="Undo" disabled={!history.undo} onClick={undo}>
            <Undo2 />
          </NoteToolbarButton>
          <NoteToolbarButton label="Redo" disabled={!history.redo} onClick={redo}>
            <Redo2 />
          </NoteToolbarButton>
        </NoteToolbarGroup>

        <span className="masar-note-toolbar-divider" aria-hidden="true" />

        <NoteToolbarGroup label="Block style">
          <NoteToolbarButton
            label="Paragraph"
            className={headingButtonClass}
            selected={currentType === "paragraph"}
            onClick={() => setBlockType("paragraph")}
          >
            <Type />
          </NoteToolbarButton>
          <NoteToolbarButton
            label="Heading 1"
            className={headingButtonClass}
            selected={currentType === "heading" && block.props.level === 1}
            onClick={() => setBlockType("heading", { level: 1 })}
          >
            <Heading1 />
          </NoteToolbarButton>
          <NoteToolbarButton
            label="Heading 2"
            className={headingButtonClass}
            selected={currentType === "heading" && block.props.level === 2}
            onClick={() => setBlockType("heading", { level: 2 })}
          >
            <Heading2 />
          </NoteToolbarButton>
          <NoteToolbarButton
            label="Heading 3"
            className={headingButtonClass}
            selected={currentType === "heading" && block.props.level === 3}
            onClick={() => setBlockType("heading", { level: 3 })}
          >
            <Heading3 />
          </NoteToolbarButton>
        </NoteToolbarGroup>

        <span className="masar-note-toolbar-divider" aria-hidden="true" />

        <NoteToolbarGroup label="Text formatting">
          <NoteToolbarButton
            label="Bold"
            selected={"bold" in activeStyles}
            onClick={() => toggleStyle("bold")}
          >
            <Bold />
          </NoteToolbarButton>
          <NoteToolbarButton
            label="Italic"
            selected={"italic" in activeStyles}
            onClick={() => toggleStyle("italic")}
          >
            <Italic />
          </NoteToolbarButton>
          <NoteToolbarButton
            label="Underline"
            selected={"underline" in activeStyles}
            onClick={() => toggleStyle("underline")}
          >
            <Underline />
          </NoteToolbarButton>
          <NoteToolbarButton
            label="Highlight"
            className={headingButtonClass}
            selected={highlightColor !== "default"}
            onClick={() => toggleHighlight("yellow")}
          >
            <Highlighter />
          </NoteToolbarButton>
        </NoteToolbarGroup>

        <span className="masar-note-toolbar-divider" aria-hidden="true" />

        <NoteToolbarGroup label="Lists and blocks">
          <NoteToolbarButton
            label="Bulleted list"
            selected={currentType === "bulletListItem"}
            onClick={() => setBlockType("bulletListItem")}
          >
            <List />
          </NoteToolbarButton>
          <NoteToolbarButton
            label="Numbered list"
            selected={currentType === "numberedListItem"}
            onClick={() => setBlockType("numberedListItem")}
          >
            <ListOrdered />
          </NoteToolbarButton>
          <NoteToolbarButton
            label="Checklist"
            className={headingButtonClass}
            selected={currentType === "checkListItem"}
            onClick={() => setBlockType("checkListItem")}
          >
            <ListChecks />
          </NoteToolbarButton>
          <NoteToolbarButton
            label="Quote"
            className={headingButtonClass}
            selected={currentType === "quote"}
            onClick={() => setBlockType("quote")}
          >
            <TextQuote />
          </NoteToolbarButton>
        </NoteToolbarGroup>

        <span className="masar-note-toolbar-divider" aria-hidden="true" />

        <NoteToolbarGroup label="Insert content">
          <NoteToolbarButton label="Insert link" onClick={openLinkEditor}>
            <Link2 />
          </NoteToolbarButton>
          <NoteToolbarButton label="Insert image" onClick={pickImage}>
            <ImagePlus />
          </NoteToolbarButton>
          <input
            ref={imageInputRef}
            className="masar-note-image-input"
            type="file"
            accept={IMAGE_ACCEPT}
            aria-label="Choose an image"
            onChange={onImageInput}
          />
        </NoteToolbarGroup>

        {linkOpen && (
          <form
            className="masar-note-link-form"
            onSubmit={createLink}
            role="group"
            aria-label="Insert link"
          >
            <input
              type="text"
              aria-label="Link URL"
              aria-invalid={linkError !== null || undefined}
              placeholder="Paste or type a link"
              value={linkUrl}
              inputMode="url"
              onChange={(event) => {
                setLinkUrl(event.currentTarget.value);
                setLinkError(null);
              }}
              onMouseDown={(event) => event.stopPropagation()}
              autoFocus
            />
            <button type="submit" className="masar-note-link-submit">
              Apply
            </button>
            <button
              type="button"
              className="masar-note-link-cancel"
              onClick={() => setLinkOpen(false)}
            >
              Cancel
            </button>
            {linkError && (
              <span
                className="masar-note-link-error"
                role="alert"
              >
                {linkError}
              </span>
            )}
          </form>
        )}

        <span className="masar-note-toolbar-divider" aria-hidden="true" />

        <NoteToolbarGroup label="Note width">
          {(
            [
              ["narrow", "Narrow"],
              ["standard", "Standard"],
              ["wide", "Wide"],
            ] as const
          ).map(([width, label]) => (
            <NoteToolbarButton
              key={width}
              label={`${label} note width`}
              selected={noteWidth === width}
              className={cn("masar-note-toolbar-width-button", widthButtonClass)}
              onClick={() => onNoteWidthChange(width)}
            >
              <NoteWidthIcon width={width} />
            </NoteToolbarButton>
          ))}
        </NoteToolbarGroup>

        <NoteToolbarGroup label="More formatting">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="masar-note-toolbar-button"
                aria-label="More formatting"
                aria-haspopup="menu"
              >
                <MoreHorizontal />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuGroup className="sm:hidden">
                <DropdownMenuLabel>Turn into</DropdownMenuLabel>
                <NoteMenuItem
                  label="Paragraph"
                  selected={currentType === "paragraph"}
                  onSelect={() => setBlockType("paragraph")}
                >
                  <Type />
                </NoteMenuItem>
                <NoteMenuItem
                  label="Heading 1"
                  selected={currentType === "heading" && block.props.level === 1}
                  onSelect={() => setBlockType("heading", { level: 1 })}
                >
                  <Heading1 />
                </NoteMenuItem>
                <NoteMenuItem
                  label="Heading 2"
                  selected={currentType === "heading" && block.props.level === 2}
                  onSelect={() => setBlockType("heading", { level: 2 })}
                >
                  <Heading2 />
                </NoteMenuItem>
                <NoteMenuItem
                  label="Heading 3"
                  selected={currentType === "heading" && block.props.level === 3}
                  onSelect={() => setBlockType("heading", { level: 3 })}
                >
                  <Heading3 />
                </NoteMenuItem>
                <NoteMenuItem
                  label="Checklist"
                  selected={currentType === "checkListItem"}
                  onSelect={() => setBlockType("checkListItem")}
                >
                  <ListChecks />
                </NoteMenuItem>
                <NoteMenuItem
                  label="Quote"
                  selected={currentType === "quote"}
                  onSelect={() => setBlockType("quote")}
                >
                  <TextQuote />
                </NoteMenuItem>
                <DropdownMenuSeparator />
              </DropdownMenuGroup>
              <DropdownMenuGroup>
                <DropdownMenuLabel>Text</DropdownMenuLabel>
                <NoteMenuItem
                  label="Strikethrough"
                  selected={"strike" in activeStyles}
                  onSelect={() => toggleStyle("strike")}
                >
                  <Strikethrough />
                </NoteMenuItem>
                <NoteMenuItem
                  label="Inline code"
                  selected={"code" in activeStyles}
                  onSelect={() => toggleStyle("code")}
                >
                  <Code />
                </NoteMenuItem>
                <NoteMenuItem
                  label="Highlight"
                  selected={highlightColor !== "default"}
                  onSelect={() => toggleHighlight("yellow")}
                >
                  <Highlighter />
                </NoteMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Insert</DropdownMenuLabel>
                <NoteMenuItem
                  label="Code block"
                  selected={currentType === "codeBlock"}
                  onSelect={() => setBlockType("codeBlock")}
                >
                  <FileCode2 />
                </NoteMenuItem>
                <NoteMenuItem label="Divider" onSelect={insertDivider}>
                  <Minus />
                </NoteMenuItem>
                <NoteMenuItem label="Table" onSelect={insertTable}>
                  <Table />
                </NoteMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Alignment</DropdownMenuLabel>
                <NoteMenuItem
                  label="Align left"
                  selected={textAlignment === "left"}
                  onSelect={() => setTextAlignment("left")}
                >
                  <AlignLeft />
                </NoteMenuItem>
                <NoteMenuItem
                  label="Align center"
                  selected={textAlignment === "center"}
                  onSelect={() => setTextAlignment("center")}
                >
                  <AlignCenter />
                </NoteMenuItem>
                <NoteMenuItem
                  label="Align right"
                  selected={textAlignment === "right"}
                  onSelect={() => setTextAlignment("right")}
                >
                  <AlignRight />
                </NoteMenuItem>
                <NoteMenuItem
                  label="Justify"
                  selected={textAlignment === "justify"}
                  onSelect={() => setTextAlignment("justify")}
                >
                  <AlignJustify />
                </NoteMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span className="mr-2 size-3.5 rounded-full border border-border bg-yellow-300/60" />
                  Highlight color
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="min-w-40">
                  {HIGHLIGHT_COLORS.map((color) => (
                    <DropdownMenuItem
                      key={color.value}
                      onSelect={() => toggleHighlight(color.value)}
                    >
                      <span
                        className={cn(
                          "mr-2 size-3.5 rounded-full",
                          SWATCH_CLASSES[color.value],
                        )}
                      />
                      {color.label}
                      {highlightColor === color.value && (
                        <Check className="ml-auto size-3.5 text-muted-foreground" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuGroup className="lg:hidden">
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Note width</DropdownMenuLabel>
                {(
                  [
                    ["narrow", "Narrow"],
                    ["standard", "Standard"],
                    ["wide", "Wide"],
                  ] as const
                ).map(([width, label]) => (
                  <NoteMenuItem
                    key={width}
                    label={`${label} note width`}
                    selected={noteWidth === width}
                    onSelect={() => onNoteWidthChange(width)}
                  >
                    <NoteWidthIcon width={width} />
                  </NoteMenuItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </NoteToolbarGroup>
      </div>
    </div>
  );
}

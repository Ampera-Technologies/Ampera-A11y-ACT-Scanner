import React, { useRef, useEffect, useId, useMemo, useState } from 'react';
import {
  Bold, CodeXml, Italic, Underline, Heading2, List, ListOrdered, Link as LinkIcon,
  Table2, Strikethrough, Quote, Undo2, Redo2, Eraser, ImagePlus, Loader2,
  Rows3, Columns3, Trash2, Scissors,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IssueAttachment, Person } from '../../lib/issue-types';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  people?: Person[];
  issueId?: number;
  onImageUpload?: (file: File) => Promise<IssueAttachment>;
}

export function RichTextEditor({ value, onChange, placeholder, people = [], issueId, onImageUpload }: RichTextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageInsertionRangeRef = useRef<Range | null>(null);
  const helpId = useId();
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [tableCell, setTableCell] = useState<HTMLTableCellElement | null>(null);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const [imageWidth, setImageWidth] = useState(100);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionRangeRef = useRef<Range | null>(null);
  const [mentionPosition, setMentionPosition] = useState({ left: 12, top: 0 });

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value && document.activeElement !== ref.current) {
      ref.current.innerHTML = value || '';
    }
  }, [value]);

  const exec = (command: string, arg?: string) => {
    document.execCommand(command, false, arg);
    ref.current?.focus();
    onChange(ref.current?.innerHTML || '');
  };

  const insertTable = () => {
    exec(
      'insertHTML',
      '<table><thead><tr><th>Heading 1</th><th>Heading 2</th><th>Heading 3</th></tr></thead><tbody><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>',
    );
  };

  const syncValue = () => onChange(ref.current?.innerHTML || '');

  const rememberImageInsertionPoint = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && ref.current?.contains(selection.anchorNode)) {
      imageInsertionRangeRef.current = selection.getRangeAt(0).cloneRange();
    } else {
      imageInsertionRangeRef.current = null;
    }
  };

  const restoreImageInsertionPoint = () => {
    ref.current?.focus();
    const range = imageInsertionRangeRef.current;
    if (!range || !ref.current?.contains(range.commonAncestorContainer)) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const selectedCell = () => {
    const node = window.getSelection()?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest('td, th') as HTMLTableCellElement | null;
  };

  const updateTableContext = () => setTableCell(selectedCell());

  const updateSelectionContext = (event?: React.MouseEvent<HTMLDivElement>) => {
    updateTableContext();
    const target = event?.target;
    const image = target instanceof HTMLImageElement ? target : null;
    setSelectedImage(image);
    if (image) {
      const savedWidth = Number.parseInt(image.style.width, 10);
      setImageWidth(Number.isFinite(savedWidth) ? savedWidth : 100);
    }
  };

  const resizeSelectedImage = (width: number) => {
    if (!selectedImage || !ref.current?.contains(selectedImage)) return;
    const safeWidth = Math.max(20, Math.min(100, Math.round(width / 5) * 5));
    selectedImage.style.width = `${safeWidth}%`;
    selectedImage.style.height = 'auto';
    selectedImage.style.maxWidth = '100%';
    setImageWidth(safeWidth);
    syncValue();
  };

  const mutateTable = (operation:
    | 'add-row-above'
    | 'add-row-below'
    | 'delete-row'
    | 'add-column-left'
    | 'add-column-right'
    | 'delete-column'
    | 'split-cell'
    | 'delete-table'
  ) => {
    const cell = selectedCell() || tableCell;
    const row = cell?.parentElement as HTMLTableRowElement | null;
    const table = cell?.closest('table');
    if (!cell || !row || !table) return;
    if (operation === 'add-row-above' || operation === 'add-row-below') {
      const newRow = document.createElement('tr');
      Array.from(row.cells).forEach((sourceCell) => {
        const nextCell = document.createElement(sourceCell.tagName.toLowerCase());
        nextCell.textContent = sourceCell.tagName === 'TH' ? 'Heading' : 'Cell';
        newRow.appendChild(nextCell);
      });
      row.parentElement?.insertBefore(
        newRow,
        operation === 'add-row-above' ? row : row.nextSibling,
      );
    } else if (operation === 'delete-row') {
      if (table.rows.length <= 1) table.remove();
      else row.remove();
    } else if (operation === 'add-column-left' || operation === 'add-column-right') {
      const index = cell.cellIndex;
      Array.from(table.rows).forEach((tableRow) => {
        const reference = tableRow.cells[index];
        const nextCell = document.createElement(reference?.tagName.toLowerCase() === 'th' ? 'th' : 'td');
        nextCell.textContent = nextCell.tagName === 'TH' ? 'Heading' : 'Cell';
        const insertionPoint = operation === 'add-column-left' ? reference : reference?.nextSibling;
        if (insertionPoint) tableRow.insertBefore(nextCell, insertionPoint);
        else tableRow.appendChild(nextCell);
      });
    } else if (operation === 'delete-column') {
      const index = cell.cellIndex;
      if (row.cells.length <= 1) table.remove();
      else Array.from(table.rows).forEach((tableRow) => tableRow.cells[index]?.remove());
    } else if (operation === 'split-cell') {
      const nextCell = document.createElement(cell.tagName.toLowerCase());
      nextCell.textContent = cell.tagName === 'TH' ? 'Heading' : 'Cell';
      const colspan = Number(cell.getAttribute('colspan') || 1);
      if (colspan > 1) {
        cell.setAttribute('colspan', String(colspan - 1));
      }
      row.insertBefore(nextCell, cell.nextSibling);
    } else {
      table.remove();
    }
    ref.current?.focus();
    setTableCell(null);
    syncValue();
  };

  const insertImage = async (file: File) => {
    if (!onImageUpload || !issueId) return;
    setIsUploadingImage(true);
    try {
      const attachment = await onImageUpload(file);
      if (!attachment.id) throw new Error('Uploaded image has no attachment ID');
      const suggestedAlt = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      const alt = window.prompt('Describe this image for people who cannot see it:', suggestedAlt);
      if (alt === null) return;
      const safeAlt = alt.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[character] ?? character));
      restoreImageInsertionPoint();
      exec('insertHTML', `<figure><img src="/api/issues/${issueId}/attachments/${attachment.id}" alt="${safeAlt}"><figcaption>${safeAlt}</figcaption></figure><p><br></p>`);
    } finally {
      setIsUploadingImage(false);
      imageInsertionRangeRef.current = null;
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.toLowerCase();
    return people
      .filter((person) => person.name.toLowerCase().includes(query) || person.email.toLowerCase().includes(query))
      .slice(0, 6);
  }, [mentionQuery, people]);

  const getCaretTextOffset = (range: Range) => {
    if (!ref.current) return 0;
    const beforeCaret = range.cloneRange();
    beforeCaret.selectNodeContents(ref.current);
    beforeCaret.setEnd(range.endContainer, range.endOffset);
    return beforeCaret.toString().length;
  };

  const createTextRange = (start: number, end: number) => {
    if (!ref.current) return null;
    const walker = document.createTreeWalker(ref.current, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current: Node | null;
    while ((current = walker.nextNode())) nodes.push(current as Text);
    const result = document.createRange();
    let offset = 0;
    let startSet = false;
    for (const node of nodes) {
      const nextOffset = offset + node.data.length;
      if (!startSet && start >= offset && start <= nextOffset) {
        result.setStart(node, Math.max(0, start - offset));
        startSet = true;
      }
      if (end >= offset && end <= nextOffset) {
        if (!startSet) result.setStart(node, Math.max(0, start - offset));
        result.setEnd(node, Math.max(0, end - offset));
        return result;
      }
      offset = nextOffset;
    }
    return startSet ? result : null;
  };

  const readMentionQuery = () => {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount || !ref.current?.contains(selection.anchorNode)) {
      setMentionQuery(null);
      return;
    }
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    const caretOffset = getCaretTextOffset(range);
    const beforeCaret = range.cloneRange();
    beforeCaret.selectNodeContents(ref.current);
    beforeCaret.setEnd(range.endContainer, range.endOffset);
    const match = beforeCaret.toString().match(/(?:^|\s)@([^\s@<]*)$/);
    if (!match) {
      setMentionQuery(null);
      mentionRangeRef.current = null;
      return;
    }
    mentionRangeRef.current = range;
    const caretRect = range.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (containerRect) {
      const menuWidth = 256;
      const estimatedMenuHeight = Math.min(220, 34 + Math.max(1, mentionMatches.length) * 52);
      const left = Math.max(
        8,
        Math.min(caretRect.left - containerRect.left, containerRect.width - menuWidth - 8),
      );
      const roomBelow = window.innerHeight - caretRect.bottom;
      const top = roomBelow >= estimatedMenuHeight + 12
        ? caretRect.bottom - containerRect.top + 6
        : caretRect.top - containerRect.top - estimatedMenuHeight - 6;
      setMentionPosition({ left, top });
    }
    setMentionQuery(match[1] ?? '');
    setMentionIndex(0);
    void caretOffset;
  };

  const insertMention = (person: Person) => {
    const savedRange = mentionRangeRef.current;
    if (!savedRange || !ref.current) return;
    const caretOffset = getCaretTextOffset(savedRange);
    const queryLength = mentionQuery?.length ?? 0;
    const mentionStart = Math.max(0, caretOffset - queryLength - 1);
    const replacementRange = createTextRange(mentionStart, caretOffset);
    if (!replacementRange) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(replacementRange);
    const safeName = person.name.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[character] ?? character));
    document.execCommand(
      'insertHTML',
      false,
      `<strong class="text-primary" data-mention-id="${person.id}">@${safeName}</strong>&nbsp;`,
    );
    ref.current.focus();
    onChange(ref.current.innerHTML || '');
    mentionRangeRef.current = null;
    setMentionQuery(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (mentionQuery === null || mentionMatches.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setMentionIndex((current) => (current + 1) % mentionMatches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setMentionIndex((current) => (current - 1 + mentionMatches.length) % mentionMatches.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      insertMention(mentionMatches[mentionIndex] ?? mentionMatches[0]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setMentionQuery(null);
      mentionRangeRef.current = null;
    }
  };

  return (
    <div ref={containerRef} className="relative border rounded-md focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent bg-background transition-all duration-200">
      <div className="flex flex-wrap items-center gap-1 border-b p-1 bg-muted/40" role="toolbar" aria-label="Text formatting">
        <Button data-testid="button-editor-undo" type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('undo'); }} title="Undo" aria-label="Undo">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button data-testid="button-editor-redo" type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('redo'); }} title="Redo" aria-label="Redo">
          <Redo2 className="h-4 w-4" />
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('bold'); }} title="Bold" aria-label="Bold">
          <Bold className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('italic'); }} title="Italic" aria-label="Italic">
          <Italic className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('underline'); }} title="Underline" aria-label="Underline">
          <Underline className="h-4 w-4" />
        </Button>
        <Button data-testid="button-editor-strikethrough" type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('strikeThrough'); }} title="Strikethrough" aria-label="Strikethrough">
          <Strikethrough className="h-4 w-4" />
        </Button>
        
        <div className="w-px h-4 bg-border mx-1" />
        
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('formatBlock', 'H3'); }} title="Heading" aria-label="Heading">
          <Heading2 className="h-4 w-4" />
        </Button>
        
        <div className="w-px h-4 bg-border mx-1" />
        
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('insertUnorderedList'); }} title="Bullet List" aria-label="Bullet list">
          <List className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('insertOrderedList'); }} title="Numbered List" aria-label="Numbered list">
          <ListOrdered className="h-4 w-4" />
        </Button>
        
        <div className="w-px h-4 bg-border mx-1" />
        
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { 
          e.preventDefault(); 
          const url = prompt('Enter URL:'); 
          if (url) exec('createLink', url); 
        }} title="Link" aria-label="Insert link">
          <LinkIcon className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); insertTable(); }} title="Insert table" aria-label="Insert table">
          <Table2 className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('formatBlock', 'PRE'); }} title="HTML code block" aria-label="Format as HTML code block">
          <CodeXml className="h-4 w-4" />
        </Button>
        <Button data-testid="button-editor-blockquote" type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('formatBlock', 'BLOCKQUOTE'); }} title="Quote" aria-label="Format as quote">
          <Quote className="h-4 w-4" />
        </Button>
        <Button data-testid="button-editor-clear-formatting" type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('removeFormat'); }} title="Clear formatting" aria-label="Clear formatting">
          <Eraser className="h-4 w-4" />
        </Button>
        {onImageUpload && issueId && (
          <>
            <input
              ref={imageInputRef}
              data-testid="input-editor-image"
              type="file"
              className="hidden"
              accept="image/*"
              aria-label="Choose an image to insert"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void insertImage(file);
              }}
            />
            <Button
              data-testid="button-editor-image"
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={isUploadingImage}
              onMouseDown={(event) => {
                event.preventDefault();
                rememberImageInsertionPoint();
              }}
              onClick={(event) => {
                event.preventDefault();
                imageInputRef.current?.click();
              }}
              title="Insert image at cursor"
              aria-label="Insert image at cursor"
            >
              {isUploadingImage ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            </Button>
          </>
        )}
      </div>
      {selectedImage && (
        <div className="flex flex-wrap items-center gap-1 border-b bg-muted/20 px-2 py-1" role="toolbar" aria-label="Image resizing">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Image size</span>
          {[25, 50, 75, 100].map((width) => (
            <Button
              key={width}
              data-testid={`button-image-width-${width}`}
              type="button"
              variant={imageWidth === width ? "secondary" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => resizeSelectedImage(width)}
            >
              {width}%
            </Button>
          ))}
          <label htmlFor={`${helpId}-image-width`} className="ml-2 text-xs text-muted-foreground">
            Custom
          </label>
          <input
            id={`${helpId}-image-width`}
            data-testid="input-image-width"
            type="range"
            min="20"
            max="100"
            step="5"
            value={imageWidth}
            onChange={(event) => resizeSelectedImage(Number(event.target.value))}
            className="h-7 w-28 accent-primary"
            aria-label={`Image width ${imageWidth}%`}
          />
          <output className="w-10 text-right text-xs text-muted-foreground">{imageWidth}%</output>
        </div>
      )}
      {tableCell && !selectedImage && (
        <div className="flex flex-wrap items-center gap-1 border-b bg-muted/20 px-2 py-1" role="toolbar" aria-label="Table editing">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Table</span>
          <Button data-testid="button-table-add-row-above" type="button" variant="outline" size="sm" className="h-7 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => mutateTable('add-row-above')}><Rows3 className="mr-1 h-3.5 w-3.5" />Row above</Button>
          <Button data-testid="button-table-add-row-below" type="button" variant="outline" size="sm" className="h-7 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => mutateTable('add-row-below')}><Rows3 className="mr-1 h-3.5 w-3.5" />Row below</Button>
          <Button data-testid="button-table-delete-row" type="button" variant="outline" size="sm" className="h-7 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => mutateTable('delete-row')}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete row</Button>
          <Button data-testid="button-table-add-column-left" type="button" variant="outline" size="sm" className="h-7 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => mutateTable('add-column-left')}><Columns3 className="mr-1 h-3.5 w-3.5" />Column left</Button>
          <Button data-testid="button-table-add-column-right" type="button" variant="outline" size="sm" className="h-7 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => mutateTable('add-column-right')}><Columns3 className="mr-1 h-3.5 w-3.5" />Column right</Button>
          <Button data-testid="button-table-delete-column" type="button" variant="outline" size="sm" className="h-7 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => mutateTable('delete-column')}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete column</Button>
          <Button data-testid="button-table-split-cell" type="button" variant="outline" size="sm" className="h-7 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => mutateTable('split-cell')}><Scissors className="mr-1 h-3.5 w-3.5" />Split cell</Button>
          <Button data-testid="button-table-delete" type="button" variant="destructive" size="sm" className="h-7 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={() => mutateTable('delete-table')}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete table</Button>
        </div>
      )}
      
      <p id={helpId} className="sr-only">Use the toolbar buttons to format text. Press Tab to move between formatting controls and the editor.</p>
      <div
        ref={ref}
        className="min-h-[120px] p-3 text-sm outline-none prose prose-sm max-w-none dark:prose-invert prose-table:w-full prose-table:border-collapse prose-th:border prose-th:p-2 prose-td:border prose-td:p-2 empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground"
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label={placeholder || "Rich text editor"}
        aria-describedby={helpId}
        data-placeholder={placeholder}
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        onBlur={(e) => { onChange(e.currentTarget.innerHTML); window.setTimeout(updateTableContext, 0); }}
        onKeyUp={() => { readMentionQuery(); updateTableContext(); }}
        onMouseUp={updateSelectionContext}
        onKeyDown={handleKeyDown}
      />
      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div
          role="listbox"
          aria-label="Mention suggestions"
          data-testid="listbox-mention-suggestions"
          className="absolute z-30 w-64 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
          style={{ left: mentionPosition.left, top: mentionPosition.top }}
        >
          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Mention someone
          </p>
          {mentionMatches.map((person, index) => (
            <button
              key={person.id}
              type="button"
              role="option"
              aria-selected={index === mentionIndex}
              data-testid={`button-mention-person-${person.id}`}
              className={`block w-full rounded px-2 py-1.5 text-left text-sm ${
                index === mentionIndex ? 'bg-muted' : 'hover:bg-muted/70'
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMention(person)}
            >
              <span className="block font-medium">{person.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{person.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

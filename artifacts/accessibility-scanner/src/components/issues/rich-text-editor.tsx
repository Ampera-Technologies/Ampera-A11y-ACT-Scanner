import React, { useRef, useEffect, useId, useMemo, useState } from 'react';
import { Bold, CodeXml, Italic, Underline, Heading2, List, ListOrdered, Link as LinkIcon, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Person } from '../../lib/issue-types';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  people?: Person[];
}

export function RichTextEditor({ value, onChange, placeholder, people = [] }: RichTextEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const helpId = useId();
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
      <div className="flex flex-wrap items-center gap-1 border-b p-1 bg-muted/40">
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('bold'); }} title="Bold" aria-label="Bold">
          <Bold className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('italic'); }} title="Italic" aria-label="Italic">
          <Italic className="h-4 w-4" />
        </Button>
        <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={(e) => { e.preventDefault(); exec('underline'); }} title="Underline" aria-label="Underline">
          <Underline className="h-4 w-4" />
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

      </div>
      
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
        onBlur={(e) => onChange(e.currentTarget.innerHTML)}
        onKeyUp={readMentionQuery}
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

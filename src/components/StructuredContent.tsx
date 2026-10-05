import React from 'react';
import {
  Lightbulb, ListOrdered, AlignLeft, BookMarked,
  ChevronRight, Star, Info, Hash,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Inline text renderer  – handles **bold**, plain text, and mixed lines
// ─────────────────────────────────────────────────────────────────────────────
const InlineText: React.FC<{ text: string }> = ({ text }) => {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i} className="font-semibold text-gray-900 dark:text-white">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Section block configs
// ─────────────────────────────────────────────────────────────────────────────
const SECTION_STYLES: Record<
  string,
  { bg: string; border: string; iconBg: string; iconColor: string; titleColor: string }
> = {
  overview: {
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800',
    iconBg: 'bg-blue-600',
    iconColor: 'text-white',
    titleColor: 'text-blue-800 dark:text-blue-300',
  },
  'key arguments': {
    bg: 'bg-teal-50 dark:bg-teal-950/30',
    border: 'border-teal-200 dark:border-teal-800',
    iconBg: 'bg-teal-600',
    iconColor: 'text-white',
    titleColor: 'text-teal-800 dark:text-teal-300',
  },
  'key findings': {
    bg: 'bg-teal-50 dark:bg-teal-950/30',
    border: 'border-teal-200 dark:border-teal-800',
    iconBg: 'bg-teal-600',
    iconColor: 'text-white',
    titleColor: 'text-teal-800 dark:text-teal-300',
  },
  'evidence': {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
    iconBg: 'bg-amber-500',
    iconColor: 'text-white',
    titleColor: 'text-amber-800 dark:text-amber-300',
  },
  'conclusions': {
    bg: 'bg-purple-50 dark:bg-purple-950/30',
    border: 'border-purple-200 dark:border-purple-800',
    iconBg: 'bg-purple-600',
    iconColor: 'text-white',
    titleColor: 'text-purple-800 dark:text-purple-300',
  },
  'key takeaways': {
    bg: 'bg-green-50 dark:bg-green-950/30',
    border: 'border-green-200 dark:border-green-800',
    iconBg: 'bg-green-600',
    iconColor: 'text-white',
    titleColor: 'text-green-800 dark:text-green-300',
  },
  default: {
    bg: 'bg-gray-50 dark:bg-gray-800/40',
    border: 'border-gray-200 dark:border-gray-700',
    iconBg: 'bg-gray-600',
    iconColor: 'text-white',
    titleColor: 'text-gray-800 dark:text-gray-200',
  },
};

const getSectionStyle = (heading: string) => {
  const lower = heading.toLowerCase();
  for (const key of Object.keys(SECTION_STYLES)) {
    if (key !== 'default' && lower.includes(key)) return SECTION_STYLES[key];
  }
  return SECTION_STYLES.default;
};

const SECTION_ICONS: Record<string, React.ReactNode> = {
  overview:       <AlignLeft size={14} />,
  'key arguments':<Lightbulb size={14} />,
  'key findings': <Lightbulb size={14} />,
  evidence:       <Info size={14} />,
  conclusions:    <BookMarked size={14} />,
  'key takeaways':<Star size={14} />,
  steps:          <ListOrdered size={14} />,
  default:        <Hash size={14} />,
};

const getIcon = (heading: string) => {
  const lower = heading.toLowerCase();
  for (const key of Object.keys(SECTION_ICONS)) {
    if (key !== 'default' && lower.includes(key)) return SECTION_ICONS[key];
  }
  return SECTION_ICONS.default;
};

// ─────────────────────────────────────────────────────────────────────────────
// Parse a block of markdown-ish text into renderable line groups
// ─────────────────────────────────────────────────────────────────────────────
type ParsedBlock =
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; n: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'divider' };

function parseMarkdown(raw: string): ParsedBlock[] {
  const lines = raw.replace(/\\n/g, '\n').split('\n');
  const blocks: ParsedBlock[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === '---') { blocks.push({ type: 'divider' }); continue; }
    if (trimmed.startsWith('### ')) { blocks.push({ type: 'heading', level: 3, text: trimmed.slice(4) }); continue; }
    if (trimmed.startsWith('## '))  { blocks.push({ type: 'heading', level: 2, text: trimmed.slice(3) }); continue; }
    if (trimmed.startsWith('# '))   { blocks.push({ type: 'heading', level: 2, text: trimmed.slice(2) }); continue; }
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)/);
    if (bulletMatch) { blocks.push({ type: 'bullet', text: bulletMatch[1] }); continue; }
    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
    if (numberedMatch) { blocks.push({ type: 'numbered', n: parseInt(numberedMatch[1]), text: numberedMatch[2] }); continue; }
    blocks.push({ type: 'paragraph', text: trimmed });
  }
  return blocks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Render a parsed block array into JSX
// ─────────────────────────────────────────────────────────────────────────────
interface BlockRendererProps {
  blocks: ParsedBlock[];
  compact?: boolean;
}

const BlockRenderer: React.FC<BlockRendererProps> = ({ blocks, compact = false }) => {
  const textSm = compact ? 'text-xs' : 'text-sm';
  const out: React.ReactNode[] = [];
  let bulletQueue: ParsedBlock[] = [];
  let numberedQueue: ParsedBlock[] = [];

  const flushBullets = (key: string) => {
    if (!bulletQueue.length) return;
    out.push(
      <ul key={`bullets-${key}`} className="space-y-1.5 my-1">
        {bulletQueue.map((b, i) => (
          <li key={i} className="flex items-start gap-2">
            <ChevronRight
              size={12}
              className="flex-shrink-0 mt-1 text-teal-500 dark:text-teal-400"
            />
            <span className={`${textSm} text-gray-700 dark:text-gray-300 leading-relaxed`}>
              <InlineText text={(b as any).text} />
            </span>
          </li>
        ))}
      </ul>
    );
    bulletQueue = [];
  };

  const flushNumbered = (key: string) => {
    if (!numberedQueue.length) return;
    out.push(
      <ol key={`numbered-${key}`} className="space-y-1.5 my-1 list-none">
        {numberedQueue.map((b, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
              {(b as any).n}
            </span>
            <span className={`${textSm} text-gray-700 dark:text-gray-300 leading-relaxed`}>
              <InlineText text={(b as any).text} />
            </span>
          </li>
        ))}
      </ol>
    );
    numberedQueue = [];
  };

  blocks.forEach((block, idx) => {
    const key = String(idx);

    if (block.type === 'bullet') {
      flushNumbered(key);
      bulletQueue.push(block);
      return;
    }
    if (block.type === 'numbered') {
      flushBullets(key);
      numberedQueue.push(block);
      return;
    }

    flushBullets(key);
    flushNumbered(key);

    if (block.type === 'divider') {
      out.push(<hr key={key} className="border-gray-200 dark:border-gray-700 my-2" />);
      return;
    }
    if (block.type === 'heading') {
      const isH2 = block.level === 2;
      out.push(
        <p
          key={key}
          className={`${
            isH2
              ? 'text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mt-4 mb-1 first:mt-0'
              : `${textSm} font-semibold text-gray-800 dark:text-gray-200 mt-2 mb-0.5`
          }`}
        >
          {block.text}
        </p>
      );
      return;
    }
    if (block.type === 'paragraph') {
      out.push(
        <p key={key} className={`${textSm} text-gray-700 dark:text-gray-300 leading-relaxed`}>
          <InlineText text={block.text} />
        </p>
      );
    }
  });

  // flush any trailing lists
  flushBullets('end');
  flushNumbered('end');

  return <>{out}</>;
};

// ─────────────────────────────────────────────────────────────────────────────
// A single named section card (used inside summary and section content)
// ─────────────────────────────────────────────────────────────────────────────
interface SectionCardProps {
  heading: string;
  blocks: ParsedBlock[];
  compact?: boolean;
}

const SectionCard: React.FC<SectionCardProps> = ({ heading, blocks, compact }) => {
  const style = getSectionStyle(heading);
  const icon  = getIcon(heading);
  return (
    <div className={`rounded-xl border ${style.bg} ${style.border} overflow-hidden`}>
      <div className={`flex items-center gap-2 px-4 py-2.5 border-b ${style.border}`}>
        <div className={`w-5 h-5 rounded-md ${style.iconBg} ${style.iconColor} flex items-center justify-center flex-shrink-0`}>
          {icon}
        </div>
        <p className={`text-xs font-bold uppercase tracking-wide ${style.titleColor}`}>{heading}</p>
      </div>
      <div className="px-4 py-3 space-y-1.5">
        <BlockRenderer blocks={blocks} compact={compact} />
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// StructuredContent — top-level exported component
// Splits a markdown string on ## headings into named section cards
// ─────────────────────────────────────────────────────────────────────────────
export interface StructuredContentProps {
  /** Raw markdown-ish string (may contain literal \n or real newlines) */
  content: string;
  /** When true uses xs font sizes, suitable for compact panels */
  compact?: boolean;
  /** Optional fallback when content is empty */
  fallback?: string;
}

export const StructuredContent: React.FC<StructuredContentProps> = ({
  content,
  compact = false,
  fallback,
}) => {
  const normalized = (content || '').replace(/\\n/g, '\n').trim();

  if (!normalized) {
    return fallback ? (
      <p className="text-sm text-gray-500 dark:text-gray-400 italic">{fallback}</p>
    ) : null;
  }

  // Check if the content has ## headings (structured)
  const hasHeadings = /^##\s+/m.test(normalized);

  if (!hasHeadings) {
    // Legacy plain-text content — render as-is with basic inline formatting
    const blocks = parseMarkdown(normalized);
    return (
      <div className="space-y-1.5">
        <BlockRenderer blocks={blocks} compact={compact} />
      </div>
    );
  }

  // Split on top-level ## headings, keeping the heading text
  const segments = normalized.split(/(?=^## )/m);
  const sections: Array<{ heading: string; blocks: ParsedBlock[] }> = [];

  // Leading text before first ## heading (if any)
  const leadingText = segments[0].startsWith('## ') ? '' : segments[0].trim();
  const headingSections = segments.filter(s => s.startsWith('## '));

  headingSections.forEach(seg => {
    const lines = seg.split('\n');
    const heading = lines[0].replace(/^##\s+/, '').trim();
    const body    = lines.slice(1).join('\n').trim();
    sections.push({ heading, blocks: parseMarkdown(body) });
  });

  return (
    <div className="space-y-3">
      {leadingText && (
        <p className={`${compact ? 'text-xs' : 'text-sm'} text-gray-700 dark:text-gray-300 leading-relaxed`}>
          <InlineText text={leadingText} />
        </p>
      )}
      {sections.map((sec, i) => (
        <SectionCard
          key={i}
          heading={sec.heading}
          blocks={sec.blocks}
          compact={compact}
        />
      ))}
    </div>
  );
};

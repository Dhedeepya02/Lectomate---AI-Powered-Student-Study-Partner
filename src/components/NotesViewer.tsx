import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import {
  BookOpen, Send, Bot, User, Brain, ClipboardCheck, Upload, Search,
  PanelLeftOpen, PanelLeftClose, PanelRightOpen, PanelRightClose,
  FileText, Loader2, GripVertical, Sparkles, Clock, Tag, Hash,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { API } from '../config/api';
import { StructuredContent } from './StructuredContent';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChatMessage {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

// ─── Per-note chat history (persists across re-renders) ──────────────────────
const chatHistories: Record<string, ChatMessage[]> = {};

const makeWelcome = (noteTitle: string): ChatMessage => ({
  id: 'welcome',
  text: `Hi! I'm your AI tutor for **${noteTitle}**. Ask me anything — I can explain concepts, summarise sections, or quiz you on the content.`,
  sender: 'bot',
  timestamp: new Date(),
});

const getHistory = (noteId: string, noteTitle: string): ChatMessage[] => {
  if (!chatHistories[noteId]) {
    chatHistories[noteId] = [makeWelcome(noteTitle)];
  }
  return chatHistories[noteId];
};

// ─── Bot message renderer (markdown-like) ────────────────────────────────────
const BotText: React.FC<{ text: string }> = ({ text }) => {
  if (!text || text.trim() === '') {
    return (
      <div className="flex items-center gap-1 py-1">
        <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 bg-teal-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    );
  }
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (line.startsWith('- ') || line.startsWith('* '))
          return (
            <div key={i} className="flex gap-1.5">
              <span className="mt-0.5 text-teal-500 flex-shrink-0">•</span>
              <span>{line.slice(2)}</span>
            </div>
          );
        if (/^\d+\.\s/.test(line))
          return (
            <div key={i} className="flex gap-1.5">
              <span className="text-teal-600 flex-shrink-0 font-semibold text-xs mt-0.5">
                {line.match(/^\d+/)?.[0]}.
              </span>
              <span>{line.replace(/^\d+\.\s/, '')}</span>
            </div>
          );
        if (line.startsWith('## ')) return <p key={i} className="font-bold text-gray-900 dark:text-white mt-1">{line.slice(3)}</p>;
        if (line.startsWith('# '))  return <p key={i} className="font-bold text-gray-900 dark:text-white text-base mt-1">{line.slice(2)}</p>;
        if (line.trim() === '---')  return <hr key={i} className="border-gray-200 dark:border-gray-700 my-1" />;
        if (line.trim() === '')     return <div key={i} className="h-1" />;
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={i}>
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={j}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        );
      })}
    </div>
  );
};

// ─── Section colours cycling for note sections ───────────────────────────────
const SECTION_ACCENTS = [
  { dot: 'bg-blue-500',   num: 'bg-blue-600',   border: 'border-l-blue-500',   badge: 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700' },
  { dot: 'bg-teal-500',   num: 'bg-teal-600',   border: 'border-l-teal-500',   badge: 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700' },
  { dot: 'bg-purple-500', num: 'bg-purple-600', border: 'border-l-purple-500', badge: 'bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-700' },
  { dot: 'bg-amber-500',  num: 'bg-amber-500',  border: 'border-l-amber-500',  badge: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700' },
  { dot: 'bg-rose-500',   num: 'bg-rose-600',   border: 'border-l-rose-500',   badge: 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-700' },
  { dot: 'bg-indigo-500', num: 'bg-indigo-600', border: 'border-l-indigo-500', badge: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-700' },
];

// ─── Main component ───────────────────────────────────────────────────────────
export const NotesViewer: React.FC = () => {
  const { notes } = useUser();
  const navigate  = useNavigate();

  // Panel state
  const [chatOpen, setChatOpen] = useState(true);
  const [docsOpen, setDocsOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(320);

  // Drag-to-resize
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = dragStartX.current - e.clientX;
      const newW  = Math.min(Math.max(dragStartW.current + delta, 240), 600);
      setChatWidth(newW);
    };
    const onUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor     = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

  const onChatDragStart = useCallback((e: React.MouseEvent) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = chatWidth;
    document.body.style.cursor     = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [chatWidth]);

  // Notes state
  const [selectedNoteId, setSelectedNoteId] = useState<string>('');
  const [searchTerm, setSearchTerm]         = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]       = useState('');
  const [isTyping, setIsTyping]         = useState(false);
  const abortRef     = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Pick first note on load
  useEffect(() => {
    if (notes.length > 0 && !selectedNoteId) {
      setSelectedNoteId(notes[0].id);
    }
  }, [notes]);

  // Load chat history when note changes
  useEffect(() => {
    if (!selectedNoteId) return;
    const note = notes.find(n => n.id === selectedNoteId);
    if (note) setChatMessages(getHistory(selectedNoteId, note.title));
  }, [selectedNoteId]);

  // Expand all sections when switching notes
  useEffect(() => {
    if (!selectedNoteId) return;
    const note = notes.find(n => n.id === selectedNoteId);
    if (note) {
      setExpandedSections(new Set(note.sections.map(s => s.id)));
    }
  }, [selectedNoteId]);

  // Scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isTyping]);

  // ─── Empty state ────────────────────────────────────────────────────────────
  if (notes.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)] bg-gray-50 dark:bg-gray-950">
        <div className="text-center px-4">
          <div className="w-20 h-20 bg-blue-50 dark:bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <BookOpen size={36} className="text-blue-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">No documents yet</h3>
          <p className="text-gray-500 dark:text-gray-400 mb-6 max-w-xs mx-auto">
            Upload a document to generate AI-powered structured study notes.
          </p>
          <button
            onClick={() => navigate('/upload')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
          >
            <Upload size={16} /> Upload Document
          </button>
        </div>
      </div>
    );
  }

  const currentDoc     = notes.find(n => n.id === selectedNoteId) || notes[0];
  const filteredNotes  = notes.filter(n =>
    n.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    n.fileName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(sectionId) ? next.delete(sectionId) : next.add(sectionId);
      return next;
    });
  };

  const allTerms = [...new Set(currentDoc.sections.flatMap(s => s.highlights))];

  // ─── Chat send ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text?: string) => {
    const msg = (text ?? chatInput).trim();
    if (!msg || isTyping) return;

    const noteKey = selectedNoteId;
    const userMsg: ChatMessage = { id: Date.now().toString(), text: msg, sender: 'user', timestamp: new Date() };
    const history = [...(chatHistories[noteKey] || []), userMsg];
    chatHistories[noteKey] = history;
    setChatMessages([...history]);
    setChatInput('');
    setIsTyping(true);

    const token = localStorage.getItem('lectomate_token');
    if (!token) {
      const e: ChatMessage = { id: (Date.now() + 1).toString(), text: 'Please log in to use the AI chat.', sender: 'bot', timestamp: new Date() };
      chatHistories[noteKey] = [...history, e];
      setChatMessages([...history, e]);
      setIsTyping(false);
      return;
    }

    const convHistory = history
      .filter(m => m.id !== 'welcome')
      .slice(-10)
      .map(m => ({ role: m.sender === 'user' ? 'user' : 'model', content: m.text }));

    const botId = `bot-${Date.now()}`;
    const botMsg: ChatMessage = { id: botId, text: '', sender: 'bot', timestamp: new Date() };
    const withBot = [...history, botMsg];
    chatHistories[noteKey] = withBot;
    setChatMessages([...withBot]);

    const controller = new AbortController();
    abortRef.current = controller;
    let accumulated = '';

    try {
      const res = await fetch(`${API}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: msg, noteId: noteKey || undefined, history: convHistory }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const fallback = await fetch(`${API}/chat/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message: msg, noteId: noteKey || undefined, history: convHistory }),
        });
        const fd = await fallback.json();
        const replyText = fd?.data?.reply || 'Sorry, I could not get a response. Please try again.';
        const final: ChatMessage = { id: botId, text: replyText, sender: 'bot', timestamp: new Date() };
        chatHistories[noteKey] = [...history, final];
        setChatMessages(prev => prev.map(m => m.id === botId ? final : m));
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.token) {
              accumulated += payload.token;
              const cur = accumulated;
              setChatMessages(prev => prev.map(m => m.id === botId ? { ...m, text: cur } : m));
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }
            if (payload.done) {
              const finalText = accumulated || 'No response received.';
              const final: ChatMessage = { id: botId, text: finalText, sender: 'bot', timestamp: new Date() };
              chatHistories[noteKey] = [...history, final];
              setChatMessages(prev => prev.map(m => m.id === botId ? final : m));
            }
          } catch { /* skip malformed */ }
        }
      }

      if (accumulated) {
        const final: ChatMessage = { id: botId, text: accumulated, sender: 'bot', timestamp: new Date() };
        chatHistories[noteKey] = [...history, final];
        setChatMessages(prev => prev.map(m => m.id === botId ? final : m));
      }
    } catch (err: any) {
      const errText = err.name === 'AbortError'
        ? (accumulated || '(Response stopped)')
        : 'Sorry, something went wrong. Please try again.';
      const final: ChatMessage = { id: botId, text: errText, sender: 'bot', timestamp: new Date() };
      chatHistories[noteKey] = [...history, final];
      setChatMessages(prev => prev.map(m => m.id === botId ? final : m));
    } finally {
      setIsTyping(false);
      abortRef.current = null;
    }
  }, [chatInput, isTyping, selectedNoteId]);

  const quickPrompts = ['Summarise this document', 'What are the key concepts?', 'Quiz me on this', 'Explain the main ideas'];

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-64px)] overflow-hidden bg-gray-50 dark:bg-gray-950 transition-colors duration-200">

      {/* ══════════════════════════════════════════════════════════════════════
          LEFT PANEL — Document list (collapsible)
      ══════════════════════════════════════════════════════════════════════ */}
      <div className={`flex flex-col bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 flex-shrink-0 ${docsOpen ? 'w-[260px]' : 'w-12'}`}>

        <div className={`flex items-center border-b border-gray-100 dark:border-gray-700 px-3 py-3 gap-2 ${docsOpen ? 'justify-between' : 'justify-center'}`}>
          <button
            onClick={() => setDocsOpen(v => !v)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors flex-shrink-0"
            title={docsOpen ? 'Collapse documents' : 'Open documents'}
          >
            {docsOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          {docsOpen && <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Documents</span>}
        </div>

        {docsOpen ? (
          <>
            <div className="px-3 pt-3 pb-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Search documents…"
                  className="w-full pl-8 pr-3 py-2 text-xs border border-gray-200 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-transparent outline-none bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:placeholder-gray-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
              {filteredNotes.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">No documents match.</p>
              ) : (
                filteredNotes.map(note => (
                  <button
                    key={note.id}
                    onClick={() => setSelectedNoteId(note.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
                      selectedNoteId === note.id
                        ? 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-800 border border-transparent'
                    }`}
                  >
                    <div className={`text-xs font-medium truncate ${selectedNoteId === note.id ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-200'}`}>
                      {note.title}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 truncate">{note.fileName}</div>
                    <div className="text-xs text-gray-300 dark:text-gray-600 mt-0.5">{note.uploadDate.toLocaleDateString()}</div>
                  </button>
                ))
              )}
            </div>

            <div className="px-3 pb-3 border-t border-gray-100 dark:border-gray-700 pt-3">
              <button
                onClick={() => navigate('/upload')}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
              >
                <Upload size={13} /> Upload New Document
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 pt-4">
            <button onClick={() => setDocsOpen(true)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors" title="Search documents">
              <Search size={17} />
            </button>
            <button onClick={() => setDocsOpen(true)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors" title="Documents">
              <BookOpen size={17} />
            </button>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          CENTER — Structured Notes
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto min-w-0 bg-gray-50 dark:bg-gray-950">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">

          {/* ── Document header ─────────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mb-2 flex-wrap">
              <FileText size={13} />
              <span className="truncate max-w-xs">{currentDoc.fileName}</span>
              <span>•</span>
              <span>{currentDoc.uploadDate.toLocaleDateString()}</span>
              {currentDoc.fileSize && <><span>•</span><span>{currentDoc.fileSize}</span></>}
              {currentDoc.readingTime != null && currentDoc.readingTime > 0 && (
                <><span>•</span><Clock size={11} /><span>{currentDoc.readingTime} min read</span></>
              )}
            </div>
            <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white leading-tight mb-3">
              {currentDoc.title}
            </h1>
            {currentDoc.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {currentDoc.tags.map((tag, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-full">
                    <Tag size={9} />{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ── AI Summary card ──────────────────────────────────────────── */}
          {(currentDoc.summary || currentDoc.sections.length > 0) && (
            <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
              {/* Card header */}
              <div className="flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-teal-600 to-blue-600">
                <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Sparkles size={16} className="text-white" />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">AI Summary</p>
                  <p className="text-xs text-teal-100">Structured study notes generated from your document</p>
                </div>
              </div>

              {/* Summary body */}
              <div className="px-5 py-5">
                {currentDoc.summary ? (
                  <StructuredContent content={currentDoc.summary} />
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                    No summary available for this document.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── All-terms pill strip ─────────────────────────────────────── */}
          {allTerms.length > 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Hash size={11} /> Key Terms
              </p>
              <div className="flex flex-wrap gap-1.5">
                {allTerms.map((term, i) => (
                  <span
                    key={i}
                    className="px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-full"
                  >
                    {term}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── Detailed Sections ────────────────────────────────────────── */}
          {currentDoc.sections.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wide flex items-center gap-2">
                <BookOpen size={14} />
                Detailed Notes
                <span className="text-xs font-normal text-gray-400 normal-case tracking-normal">
                  ({currentDoc.sections.length} sections)
                </span>
              </h2>

              {currentDoc.sections.map((section, idx) => {
                const accent    = SECTION_ACCENTS[idx % SECTION_ACCENTS.length];
                const isOpen    = expandedSections.has(section.id);

                return (
                  <div
                    key={section.id}
                    className={`bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden border-l-4 ${accent.border} transition-all duration-200`}
                  >
                    {/* Section header — always visible, click to expand/collapse */}
                    <button
                      onClick={() => toggleSection(section.id)}
                      className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      {/* Number badge */}
                      <span className={`w-6 h-6 rounded-lg ${accent.num} text-white text-xs font-bold flex items-center justify-center flex-shrink-0`}>
                        {idx + 1}
                      </span>

                      {/* Title */}
                      <span className="flex-1 text-sm font-semibold text-gray-900 dark:text-white leading-snug text-left">
                        {section.title}
                      </span>

                      {/* Section term pills (max 3, hidden on mobile) */}
                      {section.highlights.length > 0 && (
                        <div className="hidden sm:flex gap-1 flex-shrink-0">
                          {section.highlights.slice(0, 3).map((h, hi) => (
                            <span
                              key={hi}
                              className={`px-2 py-0.5 text-xs rounded-full border ${accent.badge}`}
                            >
                              {h}
                            </span>
                          ))}
                          {section.highlights.length > 3 && (
                            <span className="px-2 py-0.5 text-xs rounded-full border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                              +{section.highlights.length - 3}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Expand/collapse chevron */}
                      <span className="ml-1 text-gray-400 dark:text-gray-500 flex-shrink-0">
                        {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </span>
                    </button>

                    {/* Section content — collapsible */}
                    {isOpen && (
                      <div className="px-4 pb-5 pt-1 border-t border-gray-100 dark:border-gray-700/50">
                        <div className="mt-3">
                          <StructuredContent
                            content={section.content}
                            fallback="No content available for this section."
                          />
                        </div>

                        {/* Per-section highlights row (mobile) */}
                        {section.highlights.length > 0 && (
                          <div className="mt-4 sm:hidden flex flex-wrap gap-1.5">
                            {section.highlights.map((h, hi) => (
                              <span key={hi} className={`px-2.5 py-1 text-xs rounded-full border ${accent.badge}`}>
                                {h}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Study tools ─────────────────────────────────────────────── */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              Continue Studying
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => navigate('/flashcards')}
                className="flex items-center gap-2 px-4 py-2.5 bg-purple-600 text-white text-sm rounded-xl hover:bg-purple-700 transition-colors shadow-sm font-medium"
              >
                <Brain size={15} /> Study Flashcards
              </button>
              <button
                onClick={() => navigate('/quiz')}
                className="flex items-center gap-2 px-4 py-2.5 bg-orange-500 text-white text-sm rounded-xl hover:bg-orange-600 transition-colors shadow-sm font-medium"
              >
                <ClipboardCheck size={15} /> Take Quiz
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          DRAG HANDLE
      ══════════════════════════════════════════════════════════════════════ */}
      {chatOpen && (
        <div
          onMouseDown={onChatDragStart}
          className="w-1.5 flex-shrink-0 bg-gray-200 dark:bg-gray-700 hover:bg-teal-400 active:bg-teal-500 cursor-col-resize transition-colors flex items-center justify-center group"
          title="Drag to resize chat"
        >
          <GripVertical size={14} className="text-gray-400 group-hover:text-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          RIGHT PANEL — AI Chat (collapsible + resizable)
      ══════════════════════════════════════════════════════════════════════ */}
      <div
        className={`flex flex-col bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 transition-all duration-300 flex-shrink-0 ${chatOpen ? '' : 'w-12'}`}
        style={chatOpen ? { width: chatWidth } : undefined}
      >
        {/* Header */}
        <div className={`flex items-center border-b border-gray-100 dark:border-gray-700 px-3 py-3 gap-2 ${chatOpen ? 'justify-between' : 'justify-center'}`}>
          <button
            onClick={() => setChatOpen(v => !v)}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors flex-shrink-0"
            title={chatOpen ? 'Collapse chat' : 'Open AI chat'}
          >
            {chatOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
          </button>
          {chatOpen && (
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 bg-teal-100 dark:bg-teal-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                <Bot size={15} className="text-teal-600 dark:text-teal-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 leading-none">AI Tutor</p>
                <p className="text-xs text-teal-600 dark:text-teal-400 truncate max-w-[160px] mt-0.5">{currentDoc.title}</p>
              </div>
              <div className="ml-auto w-2 h-2 bg-green-400 rounded-full flex-shrink-0" />
            </div>
          )}
        </div>

        {chatOpen ? (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0 dark:bg-gray-900">
              {chatMessages.map(msg => (
                <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`flex items-end gap-1.5 max-w-[92%] ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${msg.sender === 'user' ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-teal-100 dark:bg-teal-900/30'}`}>
                      {msg.sender === 'user'
                        ? <User size={11} className="text-blue-600 dark:text-blue-400" />
                        : <Bot size={11} className="text-teal-600 dark:text-teal-400" />
                      }
                    </div>
                    <div className={`rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                      msg.sender === 'user'
                        ? 'bg-blue-600 text-white rounded-br-sm'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-sm'
                    }`}>
                      {msg.sender === 'bot' ? <BotText text={msg.text} /> : <span>{msg.text}</span>}
                    </div>
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="flex justify-start">
                  <div className="flex items-end gap-1.5">
                    <div className="w-6 h-6 bg-teal-100 dark:bg-teal-900/30 rounded-full flex items-center justify-center">
                      <Bot size={11} className="text-teal-600 dark:text-teal-400" />
                    </div>
                    <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl rounded-bl-sm px-3 py-2.5 flex items-center gap-1.5">
                      <Loader2 size={12} className="text-teal-500 animate-spin" />
                      <span className="text-xs text-gray-500 dark:text-gray-400">Thinking…</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick prompts */}
            <div className="px-3 pt-2 pb-1 border-t border-gray-100 dark:border-gray-700 dark:bg-gray-900">
              <div className="flex flex-wrap gap-1">
                {quickPrompts.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(p)}
                    disabled={isTyping}
                    className="text-xs px-2.5 py-1 bg-gray-100 dark:bg-gray-800 hover:bg-teal-50 dark:hover:bg-teal-900/30 hover:text-teal-700 dark:hover:text-teal-400 text-gray-600 dark:text-gray-300 rounded-full transition-colors disabled:opacity-40"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Input */}
            <div className="px-3 pb-3 pt-2 dark:bg-gray-900">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                  placeholder="Ask about this document…"
                  disabled={isTyping}
                  className="flex-1 text-xs px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-teal-400 focus:border-transparent outline-none disabled:opacity-50 bg-gray-50 dark:bg-gray-800 dark:text-gray-200"
                />
                <button
                  onClick={() => sendMessage()}
                  disabled={!chatInput.trim() || isTyping}
                  className="p-2 bg-teal-600 text-white rounded-xl hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                >
                  <Send size={13} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 pt-4">
            <button onClick={() => setChatOpen(true)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors" title="Open AI chat">
              <Bot size={17} />
            </button>
          </div>
        )}
      </div>

    </div>
  );
};

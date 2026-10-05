require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

// pdf-parse has a known issue where it reads a test file on require() in some
// environments. Suppress that by setting the test-file env var before importing.
process.env.PDF_PARSE_NO_TEST = '1';
const pdfParse = require('pdf-parse');

// -- Config -------------------------------------------------------
// Support both OPENAI_API_KEY (legacy name) and GEMINI_API_KEY
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';

if (!GEMINI_API_KEY) {
  console.error('WARNING: No AI API key found. Set GEMINI_API_KEY or OPENAI_API_KEY in environment variables.');
} else {
  console.log('AI API key loaded: ' + GEMINI_API_KEY.slice(0, 8) + '...' + GEMINI_API_KEY.slice(-4));
}

// Lazy-initialize genAI so it always uses the current key value
const getGenAI = () => {
  const key = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || '';
  if (!key) throw new Error('No AI API key configured. Set GEMINI_API_KEY in Render environment variables.');
  return new GoogleGenerativeAI(key);
};

const app = express();
// Render injects PORT automatically -- never hardcode it
const PORT = Number(process.env.PORT || 3001);
const JWT_SECRET = process.env.JWT_SECRET || 'lectomate_local_dev_secret';
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 10 * 1024 * 1024);
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lectomate';

// Accept comma-separated origins OR wildcard for CORS
const rawOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',').map(o => o.trim()).filter(Boolean);
const FRONTEND_URLS = rawOrigins;

const resolveRuntimePath = (p, fallback) => {
  const t = (p || '').trim() || fallback;
  return path.isAbsolute(t) ? t : path.join(__dirname, t);
};
const UPLOAD_DIR = resolveRuntimePath(process.env.UPLOAD_DIR, 'uploads');

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain','application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/octet-stream'
]);
const ALLOWED_EXTENSIONS = new Set(['.pdf','.doc','.docx','.txt','.ppt','.pptx']);

// â"€â"€ Mongoose Schemas â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const userSchema = new mongoose.Schema({
  name:           { type: String, required: true, trim: true },
  email:          { type: String, required: true, unique: true, lowercase: true, trim: true },
  // select:false means password is never returned unless explicitly requested with .select('+password')
  password:       { type: String, required: true, select: false },
  avatar:         { type: String, default: '' },
  joinDate:       { type: Date, default: Date.now },
  studyStreak:    { type: Number, default: 0 },
  totalDocuments: { type: Number, default: 0 },
  totalFlashcards:{ type: Number, default: 0 },
  totalQuizzes:   { type: Number, default: 0 }
});
userSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { r.id = r._id.toString(); delete r._id; delete r.__v; delete r.password; return r; } });

const documentSchema = new mongoose.Schema({
  userId:          { type: String, required: true, index: true },
  fileName:        String,
  originalName:    String,
  fileSize:        Number,
  mimeType:        String,
  filePath:        String,
  uploadedAt:      { type: Date, default: Date.now },
  processed:       { type: Boolean, default: false },
  processingError: { type: String, default: null },
  processedAt:     { type: Date, default: null }
});
documentSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { r.id = r._id.toString(); delete r._id; delete r.__v; return r; } });

const sectionSchema = new mongoose.Schema({ id: String, title: String, content: String, highlights: [String] }, { _id: false });

const noteSchema = new mongoose.Schema({
  userId:           { type: String, required: true, index: true },
  title:            { type: String, required: true },
  fileName:         { type: String, default: '' },
  uploadDate:       { type: Date, default: Date.now },
  fileSize:         { type: String, default: '0 B' },
  status:           { type: String, enum: ['processing','completed'], default: 'completed' },
  summary:          { type: String, default: '' },   // AI executive summary
  readingTime:      { type: Number, default: 0 },    // estimated minutes
  sections:         [sectionSchema],
  tags:             [String],
  rawContent:       { type: String, default: '' },
  lastAccessed:     { type: Date, default: Date.now },
  sourceDocumentId: { type: String, default: '' }
});
noteSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { r.id = r._id.toString(); delete r._id; delete r.__v; return r; } });

const flashcardSchema = new mongoose.Schema({
  userId:       { type: String, required: true, index: true },
  noteId:       { type: String, required: true, index: true },
  front:        { type: String, required: true },
  back:         { type: String, required: true },
  difficulty:   { type: String, enum: ['easy','medium','hard'], default: 'medium' },
  createdAt:    { type: Date, default: Date.now },
  lastReviewed: { type: Date, default: null },
  correctCount: { type: Number, default: 0 },
  totalReviews: { type: Number, default: 0 }
});
flashcardSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { r.id = r._id.toString(); delete r._id; delete r.__v; return r; } });

const questionSchema = new mongoose.Schema({ id: String, type: String, question: String, options: [String], correctAnswer: String, explanation: String, difficulty: String }, { _id: false });
const attemptSchema  = new mongoose.Schema({ id: String, completedAt: { type: Date, default: Date.now }, score: Number, totalQuestions: Number, timeSpent: Number }, { _id: false });

const quizSchema = new mongoose.Schema({
  userId:    { type: String, required: true, index: true },
  noteId:    { type: String, required: true, index: true },
  title:     { type: String, required: true },
  questions: [questionSchema],
  createdAt: { type: Date, default: Date.now },
  attempts:  [attemptSchema]
});
quizSchema.set('toJSON', { virtuals: true, transform: (_d, r) => { r.id = r._id.toString(); delete r._id; delete r.__v; return r; } });

const UserModel     = mongoose.model('User',     userSchema);
const DocModel      = mongoose.model('Document', documentSchema);
const NoteModel     = mongoose.model('Note',     noteSchema);
const FlashModel    = mongoose.model('Flashcard',flashcardSchema);
const QuizModel     = mongoose.model('Quiz',     quizSchema);

// â"€â"€ Helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const ensureDir = (p) => { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); };

const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  const sizes = ['B','KB','MB','GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
};

const sanitizeUser = (user) => {
  const obj = typeof user.toJSON === 'function' ? user.toJSON() : { ...user };
  delete obj.password;
  return obj;
};

const createToken = (user) =>
  jwt.sign({ id: user._id ? user._id.toString() : user.id, email: user.email }, JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ success: false, error: 'Access token required' });
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    const user = await UserModel.findById(payload.id).lean();
    if (!user) return res.status(401).json({ success: false, error: 'User not found' });
    const { password: _p, ...safe } = user;
    safe.id = user._id.toString();
    req.user = safe;
    return next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};

const extractKeywords = (text) => {
  const stop = new Set(['about','above','after','again','against','between','could','first','from','have','into','just','main','more','most','other','over','same','some','such','than','that','their','there','these','they','this','those','through','under','very','what','when','where','which','while','with','would','your']);
  const freq = new Map();
  for (const w of (text.toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g) || []))
    if (!stop.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
  return [...freq.entries()].sort((a,b) => b[1]-a[1]).slice(0,12).map(([w]) => w.charAt(0).toUpperCase()+w.slice(1));
};

const buildFallbackContent = (cleanText, originalName) => {
  const keywords = extractKeywords(cleanText);
  const baseName = (originalName || 'Document').replace(/\.[^/.]+$/, '').replace(/[-_]/g,' ');
  const sections = [{ id:'summary', title:'Document Summary', content: cleanText.slice(0,1800) || 'No readable text found.', highlights: keywords.slice(0,6) }];
  if (cleanText.length > 1800) sections.push({ id:'details', title:'Detailed Notes', content: cleanText.slice(1800,3600), highlights: keywords.slice(6,12) });
  const flashcards = keywords.slice(0,8).map((kw,i) => ({ front:`What does "${kw}" refer to in this document?`, back:`"${kw}" is a key concept from your uploaded content.`, difficulty: i<3?'easy':i<6?'medium':'hard' }));
  const shuffle = (a) => { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; };
  const questions = keywords.slice(0,5).map((kw,i) => {
    const correct = `${kw} is a key concept from this study material.`;
    return { id:`q-${i+1}`, type:'multiple-choice', question:`Which option best describes "${kw}"?`, options: shuffle([correct,`${kw} is unrelated to the document.`,`${kw} only appears in metadata.`,`${kw} is a formatting marker.`]), correctAnswer: correct, explanation:`Checks recall of "${kw}".`, difficulty: i<2?'easy':i<4?'medium':'hard' };
  });
  return { title: baseName, sections, tags: keywords.slice(0,5), flashcards, quiz: { title:`Quiz: ${baseName}`, questions } };
};

const normalizeText = (t) =>
  String(t || '')
    .replace(/\u0000/g, ' ')          // remove null bytes
    .replace(/\r\n/g, '\n')           // normalize line endings
    .replace(/\r/g, '\n')
    .replace(/[ \t]{3,}/g, '  ')      // collapse excessive spaces but keep 2
    .replace(/\n{4,}/g, '\n\n\n')     // max 3 consecutive newlines (preserve paragraph breaks)
    .trim();

const extractTextFromFile = async (filePath, mimeType) => {
  const ext = path.extname(filePath).toLowerCase();
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    const data = await pdfParse(fs.readFileSync(filePath));
    return data.text || '';
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === '.docx') {
    const r = await mammoth.extractRawText({ path: filePath });
    return r.value || '';
  }
  if (mimeType === 'text/plain' || ext === '.txt') return fs.readFileSync(filePath,'utf8');
  if (['.doc','.ppt','.pptx'].includes(ext)) return `File "${path.basename(filePath)}" uploaded. Rich text extraction limited for this format.`;
  return '';
};

// â"€â"€ AI helpers â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€

// Retry helper with exponential backoff
const withRetry = async (fn, maxAttempts = 3, baseDelayMs = 1000) => {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === maxAttempts;
      const isRetryable = err.message && (
        err.message.includes('503') ||
        err.message.includes('429') ||
        err.message.includes('overloaded') ||
        err.message.includes('timeout')
      );
      if (isLast || !isRetryable) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`AI attempt ${attempt} failed, retrying in ${delay}ms: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
};

// Strip markdown code fences from AI response
const stripCodeFences = (text) =>
  text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();

// Shuffle array in-place (Fisher-Yates)
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Estimate reading time in minutes
const estimateReadingTime = (text) => Math.max(1, Math.ceil(text.split(/\s+/).length / 200));

const generateAIContent = async (cleanText, originalName) => {
  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) return buildFallbackContent(cleanText, originalName);

  const baseName = (originalName || 'Document').replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

  const proModel = getGenAI().getGenerativeModel({
    model: 'gemini-2.5-pro',
    systemInstruction:
      'You are a precise academic content analyst. ' +
      'You extract and summarize information EXACTLY as it appears in the source document. ' +
      'Never invent, assume, or generalize beyond what the document states. ' +
      'Always return valid JSON only -- no markdown fences, no extra text.',
    generationConfig: { temperature: 0.2, topP: 0.8 },
  });

  const flashModel = getGenAI().getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction:
      'You create educational flashcards and quiz questions strictly from the provided document. ' +
      'Every question and answer must be directly traceable to the document text. ' +
      'Always return valid JSON only -- no markdown fences, no extra text.',
    generationConfig: { temperature: 0.3 },
  });

  // Keep as much text as possible -- pro model supports large context
  const fullText = cleanText.length > 30000 ? cleanText.slice(0, 30000) + '\n\n[...document continues]' : cleanText;
  const studyText = cleanText.length > 16000 ? cleanText.slice(0, 16000) : cleanText;

  try {
    // ── Call 1: Title, summary, sections ──────────────────────────────────
    const notesPrompt = `You are analyzing a student's uploaded study document. Read it carefully from start to finish, then produce highly structured, well-organized study notes suitable for exam preparation.

Return ONLY valid JSON — no markdown code fences wrapping the JSON, no extra text outside the JSON:
{
  "title": "The actual title or main topic of this document (4-10 words, derived from the document itself)",
  "summary": "## Overview\\n\\nWrite 2-3 sentences introducing what this document is about and its main purpose.\\n\\n## Key Arguments & Findings\\n\\n- **[Specific finding or argument 1]**: One sentence explanation using exact terms from the document.\\n- **[Specific finding or argument 2]**: One sentence explanation using exact terms from the document.\\n- **[Specific finding or argument 3]**: One sentence explanation using exact terms from the document.\\n\\n## Evidence & Data\\n\\n- [Specific data point, statistic, or example from the document]\\n- [Another specific data point or example]\\n\\n## Conclusions & Implications\\n\\n[2-3 sentences on the conclusions and their significance, using terminology from the document.]\\n\\n## Key Takeaways\\n\\n1. [Most important takeaway — specific and traceable to the document]\\n2. [Second most important takeaway]\\n3. [Third most important takeaway]",
  "tags": ["subject area 1", "subject area 2", "subject area 3", "subject area 4", "subject area 5"],
  "sections": [
    {
      "id": "section-1",
      "title": "Heading that exactly reflects what this section covers in the document",
      "content": "## Definition\\n\\n**[Key Term]**: Precise definition or explanation from the document.\\n\\n## Explanation\\n\\nWrite 3-5 sentences of detailed explanation. Use **bold** for important technical terms, concepts, names, and key phrases. Preserve all specific data points, dates, numbers, formulas, and acronyms exactly as they appear in the source.\\n\\n## Key Points\\n\\n- **[Important point 1]**: Brief explanation\\n- **[Important point 2]**: Brief explanation\\n- **[Important point 3]**: Brief explanation\\n\\n## Example (if applicable)\\n\\n[Specific example from the document, if one exists for this section]",
      "highlights": ["exact key term from doc", "specific name or concept", "important number or date", "central idea phrase"]
    }
  ]
}

STRICT RULES:
1. Generate 6-10 sections that together cover the ENTIRE document — do not stop at the introduction.
2. Each section must be distinct and correspond to a real part of the document's structure or content.
3. The "content" field for every section MUST use the structured markdown format shown above with ## headings, **bold** terms, and - bullet points. Adapt the headings to fit the section — if a section has steps, use ## Steps with numbered list (1. 2. 3.); if it has a comparison, use ## Comparison. Always end with ## Key Points.
4. The "summary" field MUST use the exact structured format shown, with the five sub-sections: Overview, Key Arguments & Findings, Evidence & Data, Conclusions & Implications, Key Takeaways.
5. Use **bold** around every important term, concept, name, date, number, and formula.
6. For processes or sequences, use numbered lists (1. 2. 3.) instead of bullet points.
7. Highlights must be short (1-5 words) exact phrases or terms that actually appear in the document.
8. Tags must be the real subject areas, disciplines, or themes of this specific document.
9. Never invent information — every fact must come directly from the document.
10. Use \\n to represent newlines inside JSON string values.

DOCUMENT TEXT:
${fullText}`;

    const notesResult = await withRetry(() => proModel.generateContent(notesPrompt));
    const notesText   = stripCodeFences(notesResult.response.text().trim());
    const notesParsed = JSON.parse(notesText);

    // ── Call 2: Flashcards + Quiz ──────────────────────────────────────────
    const studyPrompt = `You are creating high-quality study materials from a student's document. Every card and question must be grounded in the document text below.

Return ONLY valid JSON — no markdown, no code fences, no extra text:
{
  "flashcards": [
    {
      "front": "A precise, specific question that tests one fact, definition, relationship, or concept from the document",
      "back": "A complete, standalone answer (3-5 sentences) that fully explains the concept using the document's own language. Include context, not just a one-word answer.",
      "difficulty": "easy"
    }
  ],
  "quiz": {
    "title": "Quiz: [actual topic from document]",
    "questions": [
      {
        "id": "q1",
        "type": "multiple-choice",
        "question": "A question that requires understanding, not just word-matching. Test comprehension of a specific point.",
        "options": ["The correct answer (exact wording from document)", "A plausible distractor based on a common misconception", "Another plausible distractor", "A fourth plausible distractor"],
        "correctAnswer": "The correct answer (must exactly match one of the options above)",
        "explanation": "2-3 sentences explaining why this answer is correct, citing the specific passage or section of the document that supports it.",
        "difficulty": "medium"
      }
    ]
  }
}

FLASHCARD REQUIREMENTS — generate exactly 15 cards:
- Card distribution across the FULL document (not just the beginning):
  * 4 definition cards: "What is [term]?" with a precise definition from the document
  * 4 cause/effect or process cards: "What causes [X]?" or "What are the steps of [Y]?"
  * 4 compare/contrast or relationship cards: "How does [A] differ from [B]?" or "What is the relationship between [X] and [Y]?"
  * 3 application/analysis cards: "Why does [concept] matter?" or "What would happen if [condition]?"
- Difficulty spread: 5 easy (recall a stated fact), 6 medium (explain a relationship), 4 hard (apply or analyze)
- The back must be self-contained — a student should understand the answer without re-reading the document

QUIZ REQUIREMENTS — generate exactly 12 questions:
- 8 multiple-choice questions: exactly 4 options each, one unambiguously correct, three plausible distractors
- 4 true-false questions: options must be exactly ["True", "False"]
- Questions must span the full document — do not cluster in one section
- Distractors for multiple-choice must be plausible misconceptions, not obviously wrong
- Explanations must cite the document: reference the section, paragraph, or specific data that proves the answer
- Difficulty spread: 4 easy, 5 medium, 3 hard

DOCUMENT TEXT:
${studyText}`;

    const studyResult = await withRetry(() => flashModel.generateContent(studyPrompt));
    const studyText2  = stripCodeFences(studyResult.response.text().trim());
    const studyParsed = JSON.parse(studyText2);

    return {
      title:       notesParsed.title   || baseName,
      summary:     notesParsed.summary || '',
      readingTime: estimateReadingTime(cleanText),
      sections: (notesParsed.sections || []).map((s, i) => ({
        id:         s.id         || `section-${i + 1}`,
        title:      s.title      || `Section ${i + 1}`,
        content:    s.content    || '',
        highlights: Array.isArray(s.highlights) ? s.highlights.filter(h => h && h.trim()) : [],
      })),
      tags: Array.isArray(notesParsed.tags) && notesParsed.tags.length > 0
        ? notesParsed.tags
        : extractKeywords(cleanText).slice(0, 6),
      flashcards: (studyParsed.flashcards || [])
        .filter(f => f.front && f.back)
        .map(f => ({
          front:      f.front.trim(),
          back:       f.back.trim(),
          difficulty: ['easy', 'medium', 'hard'].includes(f.difficulty) ? f.difficulty : 'medium',
        })),
      quiz: studyParsed.quiz ? {
        title: studyParsed.quiz.title || `${notesParsed.title || baseName} Quiz`,
        questions: (studyParsed.quiz.questions || [])
          .filter(q => q.question && q.correctAnswer)
          .map((q, i) => {
            const type = ['multiple-choice', 'true-false', 'short-answer'].includes(q.type)
              ? q.type : 'multiple-choice';
            const options = type === 'multiple-choice'
              ? shuffle(Array.isArray(q.options) && q.options.length >= 2 ? q.options : [q.correctAnswer, 'None of the above'])
              : ['True', 'False'];
            return {
              id:            q.id || `q${i + 1}`,
              type,
              question:      q.question.trim(),
              options,
              correctAnswer: q.correctAnswer.trim(),
              explanation:   (q.explanation || '').trim(),
              difficulty:    ['easy', 'medium', 'hard'].includes(q.difficulty) ? q.difficulty : 'medium',
            };
          }),
      } : null,
    };

  } catch (err) {
    console.error('AI content generation failed:', err.message);
    // Flash model single-call fallback
    try {
      console.log('Falling back to gemini-2.5-flash single call...');
      const fb = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash', generationConfig: { temperature: 0.2 } });
      const fbText = cleanText.length > 12000 ? cleanText.slice(0, 12000) : cleanText;
      const fbPrompt = `You are creating structured study notes and quiz materials from a student's document. Analyze the entire document carefully.

Return ONLY valid JSON — no markdown code fences wrapping the JSON, no extra text:
{"title":"The actual document title or topic (4-10 words)","summary":"## Overview\\n\\nWhat this document is about in 2 sentences.\\n\\n## Key Arguments & Findings\\n\\n- **[Finding 1]**: explanation\\n- **[Finding 2]**: explanation\\n- **[Finding 3]**: explanation\\n\\n## Evidence & Data\\n\\n- [Specific data point or example from the document]\\n- [Another specific data point]\\n\\n## Conclusions & Implications\\n\\n2-3 sentences on conclusions using document terminology.\\n\\n## Key Takeaways\\n\\n1. Most important takeaway from the document\\n2. Second most important takeaway\\n3. Third most important takeaway","tags":["real topic 1","real topic 2","real topic 3"],"sections":[{"id":"s1","title":"Heading matching this part of the document","content":"## Definition\\n\\n**Key Term**: definition from document.\\n\\n## Explanation\\n\\nDetailed explanation using **bold** for key terms, names, numbers.\\n\\n## Key Points\\n\\n- **Point 1**: explanation\\n- **Point 2**: explanation\\n- **Point 3**: explanation","highlights":["key term","specific concept","important fact"]}],"flashcards":[{"front":"Specific question testing a fact/definition/relationship from the document","back":"Complete 3-5 sentence answer using the document's own language with full context","difficulty":"medium"}],"quiz":{"title":"Quiz: [document topic]","questions":[{"id":"q1","type":"multiple-choice","question":"Comprehension question testing a specific point","options":["correct answer from doc","plausible wrong answer","another plausible wrong","fourth plausible wrong"],"correctAnswer":"correct answer from doc","explanation":"Why correct, citing the document","difficulty":"medium"}]}}

REQUIREMENTS:
- 6 sections covering the FULL document, each section content MUST use ## headings and **bold** terms
- 12 flashcards: 3 definitions, 3 cause/effect, 3 compare/contrast, 3 application
- 10 quiz questions: 7 multiple-choice (4 options each) + 3 true-false (options must be ["True","False"])
- Every fact must come directly from the document

DOCUMENT: ${fbText}`;
      const fbResult = await fb.generateContent(fbPrompt);
      const fbParsed = JSON.parse(stripCodeFences(fbResult.response.text().trim()));
      return {
        title: fbParsed.title || baseName,
        summary: fbParsed.summary || '',
        readingTime: estimateReadingTime(cleanText),
        sections: (fbParsed.sections || []).map((s, i) => ({ id: s.id || `s${i+1}`, title: s.title || `Section ${i+1}`, content: s.content || '', highlights: Array.isArray(s.highlights) ? s.highlights : [] })),
        tags: Array.isArray(fbParsed.tags) ? fbParsed.tags : extractKeywords(cleanText).slice(0, 5),
        flashcards: (fbParsed.flashcards || []).map(f => ({ front: f.front || '', back: f.back || '', difficulty: f.difficulty || 'medium' })),
        quiz: fbParsed.quiz ? { title: fbParsed.quiz.title || `${fbParsed.title} Quiz`, questions: (fbParsed.quiz.questions || []).map((q, i) => ({ id: q.id || `q${i+1}`, type: q.type || 'multiple-choice', question: q.question || '', options: Array.isArray(q.options) ? shuffle(q.options) : ['True', 'False'], correctAnswer: q.correctAnswer || '', explanation: q.explanation || '', difficulty: q.difficulty || 'medium' })) } : null,
      };
    } catch (fbErr) {
      console.error('Fallback also failed:', fbErr.message);
      return buildFallbackContent(cleanText, originalName);
    }
  }
};

// â"€â"€ Chat -- uses Gemini's native multi-turn Chat API â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const generateChatReply = async (userMessage, notesContext, conversationHistory = []) => {
  if (!process.env.GEMINI_API_KEY && !process.env.OPENAI_API_KEY) return generateFallbackReply(userMessage);

  try {
    const model = getGenAI().getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction:
        'You are an expert AI tutor embedded in Lectomate, an AI-powered study assistant. ' +
        'Your job is to help students understand their uploaded documents deeply and accurately. ' +
        '\n\nCORE RULES:\n' +
        '- Base all answers on the provided document context. Quote or cite specific parts when relevant.\n' +
        '- Be educational: explain WHY and HOW, not just WHAT.\n' +
        '- Use clear formatting: short paragraphs, **bold** for key terms, bullet points (- item) for lists.\n' +
        '- If asked to quiz the student, generate 3-5 specific questions from the document.\n' +
        '- If asked to summarize, give a structured summary with the main points.\n' +
        '- Never say "I cannot answer" or "I don\'t have access" -- always provide value.\n' +
        '- Keep responses focused and concise (2-4 paragraphs max unless a detailed explanation is needed).',
      generationConfig: { temperature: 0.4, topP: 0.9 },
    });

    // ALWAYS include document context in every message
    const hasCtx = notesContext && notesContext.length > 0;
    const ctxBlock = hasCtx
      ? ('STUDENT DOCUMENTS:\n' + '-'.repeat(40) + '\n' + notesContext.join('\n\n' + '-'.repeat(40) + '\n\n') + '\n' + '-'.repeat(40) + '\n\n')
      : '';

    // Build valid Gemini history (role must be 'user' or 'model')
    const validHistory = conversationHistory
      .slice(-8)
      .filter(m => m.content && m.content.trim())
      .map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.content }] }));

    let chat;
    try { chat = model.startChat({ history: validHistory }); }
    catch { chat = model.startChat({ history: [] }); }

    // Always prepend document context so AI always knows what document is open
    const fullMessage = hasCtx
      ? (ctxBlock + 'Student question: ' + userMessage)
      : userMessage;

    const result = await withRetry(() => chat.sendMessage(fullMessage));
    const text = result.response.text().trim();
    return text || generateFallbackReply(userMessage);

  } catch (err) {
    console.error('Chat generation error:', err.message);
    return generateFallbackReply(userMessage);
  }
};

const generateFallbackReply = (msg) => {
  const m = msg.toLowerCase();
  if (m.includes('summarize') || m.includes('summarise') || m.includes('summary'))
    return "I can help summarize your documents! When you upload a document, I automatically generate structured notes with an executive summary and key sections. Check the Notes page to see the full breakdown.";
  if (m.includes('flashcard'))
    return "Flashcards are automatically generated when you upload a document -- covering key definitions, concepts, and relationships. Head to the Flashcards section to study them with spaced repetition!";
  if (m.includes('quiz') || m.includes('test'))
    return "Quizzes with multiple-choice and true/false questions are automatically created from your uploaded documents. Go to the Quiz section to test your knowledge!";
  if (m.includes('explain') || m.includes('what is') || m.includes('how does'))
    return "Great question! To give you the most accurate explanation, please select a specific document from the sidebar so I can answer based on your actual study materials.";
  if (m.includes('help'))
    return "I'm your AI tutor! I can:\n- Explain concepts from your documents\n- Summarize sections\n- Quiz you on the content\n- Answer questions about your study materials\n\nSelect a document from the sidebar to get started!";
  return "I'm here to help you understand your study materials! Select a document from the sidebar and ask me anything -- I can explain concepts, summarize sections, quiz you, or answer specific questions about the content.";
};

// â"€â"€ Document processing â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const processDocument = async (docRecord) => {
  try {
    const rawText = await extractTextFromFile(docRecord.filePath, docRecord.mimeType);
    const cleanText = normalizeText(rawText);
    if (!cleanText || cleanText.trim().length === 0) throw new Error('No text could be extracted');

    const aiContent = await generateAIContent(cleanText, docRecord.originalName);

    const note = await NoteModel.create({
      userId:           docRecord.userId,
      title:            aiContent.title,
      fileName:         docRecord.originalName,
      uploadDate:       new Date(),
      fileSize:         formatFileSize(docRecord.fileSize),
      status:           'completed',
      summary:          aiContent.summary || '',
      readingTime:      aiContent.readingTime || 0,
      sections:         aiContent.sections,
      tags:             aiContent.tags,
      rawContent:       cleanText,
      lastAccessed:     new Date(),
      sourceDocumentId: docRecord._id.toString()
    });

    if (aiContent.flashcards && aiContent.flashcards.length > 0) {
      await FlashModel.insertMany(aiContent.flashcards.map(f => ({
        userId: docRecord.userId, noteId: note._id.toString(),
        front: f.front, back: f.back, difficulty: f.difficulty,
        createdAt: new Date(), lastReviewed: null, correctCount: 0, totalReviews: 0
      })));
    }

    if (aiContent.quiz && aiContent.quiz.questions && aiContent.quiz.questions.length > 0) {
      await QuizModel.create({
        userId: docRecord.userId, noteId: note._id.toString(),
        title: aiContent.quiz.title,
        questions: aiContent.quiz.questions.map((q,i) => ({ ...q, id: q.id||`q${i+1}` })),
        createdAt: new Date(), attempts: []
      });
    }

    await DocModel.findByIdAndUpdate(docRecord._id, { processed: true, processedAt: new Date(), processingError: null });

    // Update user stats
    const [docCount, flashCount, quizCount] = await Promise.all([
      NoteModel.countDocuments({ userId: docRecord.userId }),
      FlashModel.countDocuments({ userId: docRecord.userId }),
      QuizModel.countDocuments({ userId: docRecord.userId })
    ]);
    await UserModel.findByIdAndUpdate(docRecord.userId, { totalDocuments: docCount, totalFlashcards: flashCount, totalQuizzes: quizCount });

    console.log(`Document processed: ${docRecord.originalName}`);
  } catch (err) {
    console.error('Document processing error:', err.message);
    await DocModel.findByIdAndUpdate(docRecord._id, { processed: false, processingError: err.message });
  }
};

// â"€â"€ Express setup â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// CORS: allow listed origins OR wildcard
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (Render health checks, curl, mobile)
    if (!origin) return callback(null, true);
    // Allow all in development
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    // Allow wildcard
    if (FRONTEND_URLS.includes('*')) return callback(null, true);
    // Allow exact match
    if (FRONTEND_URLS.includes(origin)) return callback(null, true);
    // Allow any Vercel preview deployment (*.vercel.app)
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    // Allow localhost for testing
    if (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOAD_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { ensureDir(UPLOAD_DIR); cb(null, UPLOAD_DIR); },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname||'').toLowerCase();
    if (ALLOWED_MIME_TYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.has(ext)) return cb(null, true);
    cb(new Error('Unsupported file type. Allowed: PDF, DOC, DOCX, TXT, PPT, PPTX.'));
  }
});

// â"€â"€ Health â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/health', async (_req, res) => {
  const [users, docs, notes, flash, quizzes] = await Promise.all([
    UserModel.countDocuments(), DocModel.countDocuments(), NoteModel.countDocuments(),
    FlashModel.countDocuments(), QuizModel.countDocuments()
  ]);
  res.json({ status:'ok', db:'mongodb', counts:{ users, docs, notes, flash, quizzes }, ts: new Date().toISOString() });
});

// â"€â"€ Auth â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.post('/api/auth/register', async (req, res) => {
  try {
    const name  = String(req.body.name  || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const pass  = String(req.body.password || '');
    if (!name || !email || !pass) return res.status(400).json({ success:false, error:'Name, email, and password are required' });
    if (pass.length < 6) return res.status(400).json({ success:false, error:'Password must be at least 6 characters' });
    if (await UserModel.findOne({ email })) return res.status(409).json({ success:false, error:'Email is already registered' });
    const hashed = await bcrypt.hash(pass, 12);
    const user = await UserModel.create({ name, email, password: hashed });
    const token = createToken(user);
    return res.status(201).json({ success:true, data:{ user: sanitizeUser(user), token }, message:'Registered successfully' });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ success:false, error:'Registration failed. Please try again.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const pass  = String(req.body.password || '');
    if (!email || !pass) return res.status(400).json({ success:false, error:'Email and password are required' });
    const user = await UserModel.findOne({ email }).select('+password');
    if (!user || !(await bcrypt.compare(pass, user.password)))
      return res.status(401).json({ success:false, error:'Invalid email or password' });
    const token = createToken(user);
    return res.json({ success:true, data:{ user: sanitizeUser(user), token }, message:'Login successful' });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success:false, error:'Login failed. Please try again.' });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  try {
    const user = await UserModel.findById(req.user.id).lean();
    if (!user) return res.status(404).json({ success:false, error:'User not found' });
    const { password:_p, ...safe } = user;
    safe.id = user._id.toString();
    return res.json({ success:true, data:{ user: safe } });
  } catch (err) {
    return res.status(500).json({ success:false, error:'Failed to get user' });
  }
});

// â"€â"€ Documents â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.post('/api/documents/upload', authenticate, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success:false, error:'No file uploaded' });
    const doc = await DocModel.create({
      userId: req.user.id, fileName: req.file.filename, originalName: req.file.originalname,
      fileSize: req.file.size, mimeType: req.file.mimetype, filePath: req.file.path,
      uploadedAt: new Date(), processed: false
    });
    processDocument(doc).catch(e => console.error('Async processing failed:', e));
    return res.status(201).json({ success:true, data:{ document:{ id:doc._id.toString(), fileName:doc.originalName, fileSize:doc.fileSize, uploadedAt:doc.uploadedAt, processed:doc.processed } }, message:'Document uploaded. Processing started.' });
  } catch (err) {
    console.error('Upload error:', err);
    return res.status(500).json({ success:false, error: err.message || 'Upload failed' });
  }
});

app.get('/api/documents', authenticate, async (req, res) => {
  const docs = await DocModel.find({ userId: req.user.id }).lean();
  res.json({ success:true, data:{ documents: docs.map(d => ({ id:d._id.toString(), fileName:d.originalName, fileSize:d.fileSize, uploadedAt:d.uploadedAt, processed:d.processed, processingError:d.processingError, processedAt:d.processedAt })) } });
});

app.get('/api/documents/:id/status', authenticate, async (req, res) => {
  const doc = await DocModel.findOne({ _id: req.params.id, userId: req.user.id }).lean();
  if (!doc) return res.status(404).json({ success:false, error:'Document not found' });
  res.json({ success:true, data:{ id:doc._id.toString(), processed:doc.processed, uploadedAt:doc.uploadedAt, processingError:doc.processingError, processedAt:doc.processedAt } });
});

app.delete('/api/documents/:id', authenticate, async (req, res) => {
  const doc = await DocModel.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
  if (!doc) return res.status(404).json({ success:false, error:'Document not found' });
  if (doc.filePath && fs.existsSync(doc.filePath)) try { fs.unlinkSync(doc.filePath); } catch {}
  await NoteModel.deleteMany({ sourceDocumentId: doc._id.toString(), userId: req.user.id });
  const noteIds = (await NoteModel.find({ sourceDocumentId: doc._id.toString(), userId: req.user.id }).select('_id').lean()).map(n => n._id.toString());
  await FlashModel.deleteMany({ userId: req.user.id, noteId: { $in: noteIds } });
  await QuizModel.deleteMany({ userId: req.user.id, noteId: { $in: noteIds } });
  res.json({ success:true, message:'Document and study content deleted' });
});

// â"€â"€ Notes â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/notes', authenticate, async (req, res) => {
  const notes = await NoteModel.find({ userId: req.user.id }).lean();
  res.json({ success:true, data:{ notes: notes.map(n => ({ ...n, id:n._id.toString() })) } });
});

// â"€â"€ Flashcards â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/flashcards', authenticate, async (req, res) => {
  const query = { userId: req.user.id };
  if (req.query.noteId) query.noteId = req.query.noteId;
  const cards = await FlashModel.find(query).lean();
  res.json({ success:true, data:{ flashcards: cards.map(c => ({ ...c, id:c._id.toString() })) } });
});

app.post('/api/flashcards/:id/review', authenticate, async (req, res) => {
  const correct = req.body.correct === true;
  const card = await FlashModel.findOneAndUpdate(
    { _id: req.params.id, userId: req.user.id },
    { $set: { lastReviewed: new Date() }, $inc: { totalReviews: 1, correctCount: correct ? 1 : 0 } },
    { new: true }
  ).lean();
  if (!card) return res.status(404).json({ success:false, error:'Flashcard not found' });
  res.json({ success:true, data:{ flashcard: { ...card, id:card._id.toString() } }, message:'Review recorded' });
});

// â"€â"€ Quizzes â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/quizzes', authenticate, async (req, res) => {
  const query = { userId: req.user.id };
  if (req.query.noteId) query.noteId = req.query.noteId;
  const quizzes = await QuizModel.find(query).lean();
  res.json({ success:true, data:{ quizzes: quizzes.map(q => ({ ...q, id:q._id.toString() })) } });
});

app.post('/api/quizzes/:id/attempt', authenticate, async (req, res) => {
  const quiz = await QuizModel.findOne({ _id: req.params.id, userId: req.user.id });
  if (!quiz) return res.status(404).json({ success:false, error:'Quiz not found' });
  const answers = Array.isArray(req.body.answers) ? req.body.answers : [];
  if (answers.length !== quiz.questions.length) return res.status(400).json({ success:false, error:'Answers array must match question count' });
  const scored = quiz.questions.map((q,i) => {
    const userAnswer = answers[i];
    const isCorrect = userAnswer === q.correctAnswer;
    return { question:q.question, userAnswer, correctAnswer:q.correctAnswer, isCorrect, explanation:q.explanation };
  });
  const correctCount = scored.filter(s => s.isCorrect).length;
  const score = Math.round((correctCount / quiz.questions.length) * 100);
  const attempt = { id:uuidv4(), completedAt:new Date(), score, totalQuestions:quiz.questions.length, timeSpent:Number(req.body.timeSpent||0) };
  quiz.attempts.push(attempt);
  await quiz.save();
  res.json({ success:true, data:{ attempt, gradedQuestions:scored }, message:'Quiz attempt submitted' });
});

// â"€â"€ User profile update â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { ensureDir(UPLOAD_DIR); cb(null, UPLOAD_DIR); },
    filename: (_req, file, cb) => cb(null, `avatar-${Date.now()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) return cb(null, true);
    cb(new Error('Only image files are allowed for avatars.'));
  }
});

app.put('/api/user/profile', authenticate, async (req, res) => {
  try {
    const { name } = req.body;
    const updates = {};
    if (name && String(name).trim()) updates.name = String(name).trim();
    const user = await UserModel.findByIdAndUpdate(req.user.id, updates, { new: true }).lean();
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const { password: _p, ...safe } = user;
    safe.id = user._id.toString();
    return res.json({ success: true, data: { user: safe }, message: 'Profile updated' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

app.put('/api/user/password', authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ success: false, error: 'Both current and new password are required' });
    if (newPassword.length < 6) return res.status(400).json({ success: false, error: 'New password must be at least 6 characters' });
    const user = await UserModel.findById(req.user.id).select('+password');
    if (!user || !(await bcrypt.compare(currentPassword, user.password)))
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    return res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to update password' });
  }
});

app.post('/api/user/avatar', authenticate, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No image uploaded' });
    const avatarUrl = `/uploads/${req.file.filename}`;
    const user = await UserModel.findByIdAndUpdate(req.user.id, { avatar: avatarUrl }, { new: true }).lean();
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    const { password: _p, ...safe } = user;
    safe.id = user._id.toString();
    return res.json({ success: true, data: { user: safe, avatarUrl }, message: 'Avatar updated' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to upload avatar' });
  }
});

// â"€â"€ Serve document file by document ID â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.get('/api/documents/:id/file', authenticate, async (req, res) => {
  try {
    const doc = await DocModel.findOne({ _id: req.params.id, userId: req.user.id }).lean();
    if (!doc) return res.status(404).json({ success: false, error: 'Document not found' });
    if (!doc.filePath || !fs.existsSync(doc.filePath))
      return res.status(404).json({ success: false, error: 'File not found on disk' });
    res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.originalName)}"`);
    res.sendFile(path.resolve(doc.filePath));
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to serve file' });
  }
});
// Helper: build document context string (no mojibake chars)
const buildDocContext = (targetNotes) => {
  if (!targetNotes || targetNotes.length === 0) return '';
  const sep = '-'.repeat(50);
  const docs = targetNotes.map(n => {
    const docText = n.rawContent && n.rawContent.trim()
      ? n.rawContent.slice(0, 12000)
      : (n.sections || []).map(s => '[' + s.title + ']\n' + s.content).join('\n\n');
    return 'Document: "' + n.title + '" (' + n.fileName + ')\n' + sep + '\n' + docText;
  });
  return 'STUDENT DOCUMENTS:\n' + sep + '\n' + docs.join('\n\n' + sep + '\n\n') + '\n' + sep + '\n\n';
};

// Helper: build valid Gemini history array
const buildGeminiHistory = (conversationHistory) => {
  return (conversationHistory || [])
    .slice(-8)
    .filter(m => m && m.content && String(m.content).trim())
    .map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: String(m.content) }]
    }));
};

// -- Non-streaming chat endpoint (used as fallback) --
app.post('/api/chat/message', authenticate, async (req, res) => {
  try {
    const msg = String(req.body.message || '').trim();
    if (!msg) return res.status(400).json({ success: false, error: 'Message is required' });

    const noteId = req.body.noteId;
    const conversationHistory = Array.isArray(req.body.history) ? req.body.history : [];

    const allNotes = await NoteModel.find({ userId: req.user.id }).lean();
    const targetNotes = noteId
      ? allNotes.filter(n => n._id.toString() === noteId)
      : allNotes.slice(0, 2);

    const ctx = buildDocContext(targetNotes);
    const reply = await generateChatReply(msg, ctx ? [ctx] : [], conversationHistory);
    res.json({ success: true, data: { reply } });
  } catch (err) {
    console.error('Chat message error:', err.message);
    res.json({ success: true, data: { reply: generateFallbackReply(req.body.message || '') } });
  }
});

// -- Streaming chat endpoint (SSE) --
app.post('/api/chat/stream', authenticate, async (req, res) => {
  const msg = String(req.body.message || '').trim();
  if (!msg) return res.status(400).json({ success: false, error: 'Message is required' });

  const noteId = req.body.noteId;
  const conversationHistory = Array.isArray(req.body.history) ? req.body.history : [];

  // SSE headers -- critical for production (Render/Vercel proxy)
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.flushHeaders();

  const send = (data) => {
    try {
      res.write('data: ' + JSON.stringify(data) + '\n\n');
    } catch (e) { /* client disconnected */ }
  };

  // Keep-alive ping every 15s to prevent Render from closing idle connections
  const keepAlive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (e) { clearInterval(keepAlive); }
  }, 15000);

  const cleanup = () => clearInterval(keepAlive);
  req.on('close', cleanup);

  try {
    const apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || '';

    if (!apiKey) {
      console.warn('No AI API key found in environment variables');
      const fallback = generateFallbackReply(msg);
      const words = fallback.split(' ');
      for (const word of words) {
        send({ token: word + ' ' });
        await new Promise(r => setTimeout(r, 20));
      }
      send({ done: true });
      cleanup();
      return res.end();
    }

    // Fetch notes for context
    const allNotes = await NoteModel.find({ userId: req.user.id }).lean();
    const targetNotes = noteId
      ? allNotes.filter(n => n._id.toString() === noteId)
      : allNotes.slice(0, 2);

    const ctxBlock = buildDocContext(targetNotes);
    const geminiHistory = buildGeminiHistory(conversationHistory);

    // Always include document context in the message
    const fullMessage = ctxBlock
      ? ctxBlock + 'Student question: ' + msg
      : msg;

    console.log('Chat stream: noteId=' + (noteId || 'none') + ' hasContext=' + !!ctxBlock + ' historyLen=' + geminiHistory.length);

    const model = getGenAI().getGenerativeModel({
      model: 'gemini-2.5-flash',
      systemInstruction:
        'You are an expert AI tutor embedded in Lectomate, an AI-powered study assistant. ' +
        'Your job is to help students understand their uploaded documents deeply and accurately. ' +
        '\n\nCORE RULES:\n' +
        '- Base all answers strictly on the provided document context. Quote or cite specific parts when relevant.\n' +
        '- Be educational: explain WHY and HOW, not just WHAT.\n' +
        '- Use clear formatting: short paragraphs, **bold** for key terms, bullet points (- item) for lists.\n' +
        '- If asked to quiz the student, generate 3-5 specific questions directly from the document.\n' +
        '- If asked to summarize, give a structured summary with the main points from the document.\n' +
        '- Never say "I cannot answer" or "I don\'t have access" — always provide value from what is available.\n' +
        '- Keep responses focused and concise (2-4 paragraphs max unless a detailed explanation is needed).',
      generationConfig: { temperature: 0.4, topP: 0.9 },
    });

    let chat;
    try {
      chat = model.startChat({ history: geminiHistory });
    } catch (histErr) {
      console.warn('History error, starting fresh:', histErr.message);
      chat = model.startChat({ history: [] });
    }

    const streamResult = await chat.sendMessageStream(fullMessage);
    let hasContent = false;

    for await (const chunk of streamResult.stream) {
      const chunkText = chunk.text();
      if (chunkText) {
        hasContent = true;
        send({ token: chunkText });
      }
    }

    if (!hasContent) {
      send({ token: generateFallbackReply(msg) });
    }

    send({ done: true });
    cleanup();
    res.end();

  } catch (err) {
    console.error('Stream chat error:', err.message);
    let errToken;
    if (err.message && (err.message.includes('API key') || err.message.includes('403'))) {
      errToken = 'The AI service is temporarily unavailable. Please try again in a moment.';
      console.error('Gemini API key issue — verify GEMINI_API_KEY is set correctly in your environment.');
    } else if (err.message && (err.message.includes('429') || err.message.includes('quota'))) {
      errToken = 'The AI service is rate-limited right now. Please wait a few seconds and try again.';
    } else if (err.message && (err.message.includes('503') || err.message.includes('overloaded'))) {
      errToken = 'The AI service is temporarily overloaded. Please try again in a moment.';
    } else {
      errToken = 'Sorry, something went wrong while generating a response. Please try again.';
    }
    send({ token: errToken });
    send({ done: true });
    cleanup();
    res.end();
  }
});

app.get('/api/chat/suggestions', authenticate, (_req, res) => {
  res.json({ success: true, data: { suggestions: ['Summarize my latest document', 'Generate flashcards', 'Create a quiz', 'Explain this topic'] } });
});

// â"€â"€ Error handling â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE')
    return res.status(400).json({ success:false, error:`File too large. Max: ${formatFileSize(MAX_FILE_SIZE)}.` });
  if (err && err.message && err.message.startsWith('Unsupported file type'))
    return res.status(400).json({ success:false, error: err.message });
  console.error('Server error:', err);
  return res.status(500).json({ success:false, error: err.message || 'Internal server error' });
});

app.use((_req, res) => res.status(404).json({ success:false, error:'Route not found' }));

// â"€â"€ Start server â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
(async () => {
  try {
    console.log('ðŸ"Œ Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    console.log('âœ... MongoDB connected');
    ensureDir(UPLOAD_DIR);
    // Must listen on 0.0.0.0 for Render (not just localhost)
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`ðŸš€ Server running on port ${PORT}`);
      console.log(`ðŸ"Š Health: http://0.0.0.0:${PORT}/health`);
      console.log(`ðŸŒ NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (err) {
    console.error('âŒ Failed to start server:', err.message);
    process.exit(1);
  }
})();

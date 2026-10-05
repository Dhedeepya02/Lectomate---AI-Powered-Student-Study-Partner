# 📚 Lectomate — AI-Powered Study Assistant

Lectomate is an AI-powered study assistant that helps students learn smarter by converting study documents into **notes, flashcards, quizzes, and an interactive AI tutor**.

## 🌐 Live Demo

🔗 https://lecto-mate-ai-powered-study-partner.vercel.app/

---

## ✨ Features

- 📄 Upload PDF, DOCX, and TXT documents
- 📝 Generate AI-powered study notes
- 🧠 Generate flashcards for revision
- ❓ Generate quizzes with explanations
- 🤖 Chat with an AI tutor based on uploaded documents
- 👤 Student profile and progress tracking
- 🔗 Client-side routing with unique URLs
- 📚 Document-based personalized learning

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express.js |
| Database | MongoDB, Mongoose |
| AI | Google Gemini |
| Authentication | JWT, bcryptjs |
| Deployment | Vercel, Render |
| Database Hosting | MongoDB Atlas |

---

## 🏗️ System Architecture

```text
                    ┌──────────────────────┐
                    │       Student        │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │   React Frontend     │
                    │ React + TypeScript   │
                    │ + Vite               │
                    └──────────┬───────────┘
                               │
                         HTTPS / REST API
                               │
                               ▼
                    ┌──────────────────────┐
                    │   Express Backend    │
                    │      Node.js         │
                    └──────────┬───────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
       ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
       │ Google Gemini│ │  MongoDB    │ │ JWT / bcrypt │
       │     AI       │ │    Atlas    │ │ Authentication│
       └──────────────┘ └─────────────┘ └──────────────┘

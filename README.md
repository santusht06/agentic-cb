# 🌐 agentic-cb (CLI Browser)

> **Centralized multi-platform control plane & policy-aware browser runtime engineered for AI agents and developers.**

`cb` bridges the gap between AI agents, automation pipelines, and modern web applications. It provides a real V8 JavaScript runtime, persistent session state, direct in-session HTTP/2 APIs, automated `robots.txt` policy verification, interactive security challenge detection, and unified messaging control planes for **Google Chat**, **WhatsApp Web**, and **LinkedIn**.

---

## 🏛️ Architecture

```
                    AI Agent / Developer Terminal
                                  │
                               Commands
        (send, gchat, wa, linkedin, open, dump, eval, login)
                                  │
                                  ▼
         ┌──────────────────────────────────────────────────┐
         │          Universal Dispatcher & Policy           │
         ├──────────────────────────────────────────────────┤
         │  • robots.txt rule verification                  │
         │  • Challenge Detector (Cloudflare / CAPTCHA)     │
         │  • Dynamic profile state management (~/.v8_cli)  │
         └────────────────────────┬─────────────────────────┘
                                  │
         ┌────────────────────────┴─────────────────────────┐
         │                                                  │
         ▼                                                  ▼
┌─────────────────────────────────┐        ┌─────────────────────────────────┐
│     Direct In-Session Engine    │        │      Native CDP Bridge Engine   │
├─────────────────────────────────┤        ├─────────────────────────────────┤
│ • LinkedIn Server API (0 DOM)   │        │ • Live Chrome Attach (--attach) │
│ • Multi-Profile Sessions        │        │ • Port 9222 Remote Debugging    │
│ • Semantic Accessibility Tree   │        │ • Real hardware typing / clicks │
└─────────────────────────────────┘        └─────────────────────────────────┘
                 │                                          │
                 ▼                                          ▼
     ┌───────────────────────┐                  ┌───────────────────────┐
     │  LinkedIn Server API  │                  │  Google Chat / WA Web │
     └───────────────────────┘                  └───────────────────────┘
```

---

## 🚀 Key Features

- **⚡ Universal Send Engine**: Dispatch messages to any platform with a single command (`cb send gchat|wa|linkedin <recipient> <message>`).
- **💬 Google Chat Suite**: Authenticate, list DMs and Spaces, read conversation threads, and send messages autonomously.
- **📱 WhatsApp Web Suite**: One-time QR pairing, view recent chats, filter unread messages, inspect thread history, and dispatch messages.
- **💼 LinkedIn Control Plane**: Server‑verified member identity, profile analytics, viewers, connections, search, feed reading, and post publishing.
- **🔌 Native Chrome CDP Bridge**: Seamlessly attach to existing running Chrome instances on port 9222 without logging in again.
- **🤖 AI‑Agent JSON API**: Pass `-j, --json` to any command to receive clean, deterministic structured JSON for agent workflows.
- **🛡️ Policy & Guardrail Engine**: Built‑in `robots.txt` checks and automated bot challenge detection (Cloudflare Turnstile, Arkose Labs, CAPTCHA).

---

## 📦 Installation & Setup

### Prerequisites
- Node.js >= 18.0.0
- Google Chrome or Chromium

### Clone and Install Globally
```bash
git clone https://github.com/santusht06/agentic-cb.git
cd agentic-cb
npm install
npm link
```

Verify installation:
```bash
cb --help
```

---

## ⚙️ Configuration

The optional `.env` file lets you customize runtime behaviour. Copy the example and edit as needed:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|----------|-------------|---------|
| `CDP_PORT` | Port for native Chrome attachment (CDP). | `9222` |
| `DEFAULT_PROFILE` | Name of the default profile for persistent sessions. | `default` |
| `HEADLESS` | Run the browser headlessly (`true`/`false`). | `true` |

These values are read at startup and override built‑in defaults.

---

## 🕹️ Command Reference

### 1. ⚡ Universal Message Dispatcher
```bash
# Send to Google Chat
cb send gchat "Jane Doe" "Hello! Testing unified agent dispatch."

# Send to WhatsApp
cb send wa "John Smith" "Meeting starts in 10 minutes."

# Send to LinkedIn
cb send linkedin "Alex Rivera" "Thanks for connecting!"

# Machine‑readable output for AI agents
cb --json send gchat "Engineering Space" "Build #42 deployed successfully."
```

---

### 2. 💬 Google Chat Control Plane (`cb gchat`)

```bash
# 1. Authenticate / Login session (saved permanently)
cb gchat login

# 2. List recent conversations (DMs & Spaces)
cb gchat list --limit 10

# 3. Read message history in a conversation
cb gchat read "Team Workspace" --limit 10

# 4. Send a message
cb gchat send "Team Workspace" "Automated standup report: all systems operational."
```

---

### 3. 📱 WhatsApp Web Control Plane (`cb wa`)

```bash
# 1. Pair WhatsApp Web via QR code (saved to profile)
cb wa login

# 2. List recent chats & unread badges
cb wa chats --limit 15

# 3. Filter only chats with unread messages
cb wa unread

# 4. Read message history
cb wa read "Support Group" --limit 10

# 5. Send message
cb wa send "Support Group" "Acknowledged. Investigating issue now."
```

---

### 4. 💼 LinkedIn Control Plane (`cb linkedin`)

```bash
# 1. Authenticate session
cb --profile linkedin login https://www.linkedin.com/login

# 2. Inspect authenticated member identity (< 80ms server response)
cb linkedin me

# 3. Inspect profile viewers & discovery sources
cb linkedin viewers

# 4. List network connections
cb linkedin network list --limit 15

# 5. Search people, jobs, companies, or posts
cb linkedin search "AI Engineer" --type people --limit 5

# 6. Read LinkedIn inbox
cb linkedin msg list --limit 10

# 7. Send message to connection
cb linkedin msg send "Jane Doe" "Hi Jane, great meeting you today!"

# 8. View feed & publish updates
cb linkedin feed --limit 5
cb linkedin post "Excited to share our new agentic CLI tooling!"
```

---

### 5. 🚀 Native Chrome CDP Bridge (`cb chrome:start` / `--attach`)

Attach directly to your active native Google Chrome tabs without separate logins:

```bash
# Start native Chrome with remote debugging on port 9222
cb chrome:start --port 9222

# Control active tabs directly
cb --attach send gchat "Jane Doe" "Hello from live Chrome!"
cb --attach gchat list
```

---

### 6. 🌐 Policy‑Aware Web Navigation & DOM Perception

```bash
# Navigate to URL with robots.txt safety checks
cb open https://news.ycombinator.com

# Dump token‑efficient semantic accessibility tree for agents
cb dump https://news.ycombinator.com

# Multi‑identity session profiles
cb --profile personal open https://github.com
cb --profile work open https://work-portal.example.com
```

---

## 🤖 AI Agent JSON Output Example

Add `-j` or `--json` to any command:

```bash
cb --json send gchat "Jane Doe" "Status report attached."
```

**Output:**
```json
{
  "ok": true,
  "platform": "gchat",
  "recipient": "Jane Doe",
  "message": "Status report attached."
}
```

---

## 🔒 Security & Privacy

- **Local Storage Only**: All session cookies and profile caches are stored locally in your home directory (`~/.v8_cli/profiles/`).
- **No Telemetry**: No personal credentials, tokens, or messages are ever transmitted to third‑party tracking services.
- **Explicit Exclusions**: Personal marksheets, resumes, and test fixtures are strictly excluded via `.gitignore`.

---

## 📄 License

MIT License © 2026 Open Source Contributors
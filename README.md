<p align="center">
  <a href="https://coderax">
    <img src="client/public/assets/logo.svg" height="256">
  </a>
  <h1 align="center">
    <a href="https://coderax">Coderax</a>
  </h1>
</p>

<p align="center">
  <strong>English</strong> ·
  <a href="README.zh.md">中文</a>
</p>

<p align="center">
  <a href="https://discord.coderax"> 
    <img
      src="https://img.shields.io/discord/1086345563026489514?label=&logo=discord&style=for-the-badge&logoWidth=20&logoColor=white&labelColor=000000&color=blueviolet">
  </a>
  <a href="https://www.youtube.com/@Coderax"> 
    <img
      src="https://img.shields.io/badge/YOUTUBE-red.svg?style=for-the-badge&logo=youtube&logoColor=white&labelColor=000000&logoWidth=20">
  </a>
  <a href="https://docs.coderax"> 
    <img
      src="https://img.shields.io/badge/DOCS-blue.svg?style=for-the-badge&logo=read-the-docs&logoColor=white&labelColor=000000&logoWidth=20">
  </a>
  <a aria-label="Sponsors" href="https://github.com/sponsors/danny-avila">
    <img
      src="https://img.shields.io/badge/SPONSORS-brightgreen.svg?style=for-the-badge&logo=github-sponsors&logoColor=white&labelColor=000000&logoWidth=20">
  </a>
</p>

<p align="center">
<a href="https://railway.com/deploy/coderax-official?referralCode=HI9hWz&utm_medium=integration&utm_source=readme&utm_campaign=coderax">
  <img src="https://railway.com/button.svg" alt="Deploy on Railway" height="30">
</a>
<a href="https://zeabur.com/templates/0X2ZY8">
  <img src="https://zeabur.com/button.svg" alt="Deploy on Zeabur" height="30"/>
</a>
<a href="https://template.cloud.sealos.io/deploy?templateName=coderax">
  <img src="https://raw.githubusercontent.com/labring-actions/templates/main/Deploy-on-Sealos.svg" alt="Deploy on Sealos" height="30">
</a>
</p>

<p align="center">
  <a href="https://www.coderax/docs/translation">
    <img 
      src="https://img.shields.io/badge/dynamic/json.svg?style=for-the-badge&color=2096F3&label=locize&query=%24.translatedPercentage&url=https://api.locize.app/badgedata/4cb2598b-ed4d-469c-9b04-2ed531a8cb45&suffix=%+translated" 
      alt="Translation Progress">
  </a>
</p>

## 🎯 Coderax mission: universal, verified AI execution

Coderax aims to execute **any authorized, technically supported objective** through
models, agents, software, connected tools and specialized engines. Its job is to
**deliver verified outcomes**, not only chat responses, code changes or status updates.

The shared execution lifecycle is:

`Discover → Authorize → Plan → Execute → Observe → Verify → Deliver`

- **General-purpose Work:** Route tasks through Coderax's own authenticated models and
  agent infrastructure. CyVox is an *optional* integration, not a prerequisite.
- **Agent coordination:** Support permission-scoped delegation, collaboration,
  scheduling, multi-agent orchestration, authenticated A2A, swarms and multi-hop
  communication. Do not equate an in-app handoff with external A2A interoperability.
- **Tools and modalities:** Allow explicitly authorized browser, terminal, file,
  repository and service adapters. Movie/video/voice/3D engines should be replaceable
  capabilities, not mandatory hosted-platform dependencies.
- **Operational efficiency:** Minimize elapsed task time, human intervention,
  unnecessary agent fan-out, compute cost and operating expense together.
- **Outcome evidence:** Measure successful task completion, real artifact quality,
  latency, cost and attributable customer revenue. PR count or a deployed UI alone
  is not a successful business outcome.
- **Safety and control:** Preserve tenant isolation, least-privilege tool access,
  action-specific approvals, audit traces, cancellation, recovery and hard budgets.
  Never silently invoke paid providers or perform irreversible actions without
  authorization.

### Implementation and certification status

Chat and Work now render through the same conversation route, header, canvas and
composer. The mode buttons update account/conversation-scoped browser state, not
the pathname, query string or hash. Legacy `/work/:conversationId` links still
open their existing transcript in that shared interface. Work's agent/model
choices are scoped separately from Chat settings and revalidated against the
server's free/local catalog; the native generation and authorization paths are
unchanged. Entering Work in an owned Chat conversation adds execution metadata
to that record instead of creating a second history.

Work does not consider a model eligible solely because its identifier has a
local-looking prefix. It trusts the server catalog's existing free/local flags,
including local endpoint classifications; these are not independently verified
proof that the configured inference endpoint costs $0.

Focused component tests cover unchanged router location, composer identity,
draft/file-input retention and mode restoration. Native Work seed tests cover
in-place promotion, tenant rejection and failed storage operations. These are
not production certification: browser lifecycle/screenshot checks, full backend
validation and deployment verification are still required. Adaptive requirements
discovery and a durable, server-enforced specification-approval gate are **not
implemented** by the shared-mode change; existing native action approvals are
not a substitute for that gate.

This is a **product direction, not a claim of universal production capability**.
The repository has agent discovery, MCP, subagents, attached code workspaces and
a workflow engine. The swarm coordination code includes an opt-in, atomic
compare-and-swap coordinator. A durable Mongo-backed lease repository now lives
in `packages/data-schemas` with locally executed cross-process claim and fencing
tests; no runtime constructs a swarm yet, so an explicit permission-scoped
feature gate and production certification remain incomplete.

| Workstream | Current validation boundary | Tracking |
| --- | --- | --- |
| Native Work and CyVox independence | Source changes and focused regressions under review; deployed real-model lifecycle still needs verification | [#92](https://github.com/CoderaxAI/Coderax/issues/92) |
| Seven multi-agent capabilities | Individual local tests exist, but real multi-agent, external A2A, durable swarm runtime and production behavior are not certified | [#88](https://github.com/CoderaxAI/Coderax/issues/88) |
| CI and real deployed end-to-end checks | GitHub-hosted Actions have been blocked before job steps by an account-level restriction; staging/production certification must not be inferred from tests or previews | [#141](https://github.com/CoderaxAI/Coderax/issues/141) |

### Verified local checks (2026-11-04)

Run with installed dependencies on `main@1ef8647`: durable lease repository 5/5,
durable lease adapter 5/5, in-memory lease contract 17/17, Work dependency guards
18/18, conversation turn saves 24/24, conversation storage 352/352, Work chat
route 48/48 and Work model projection 8/8. GitHub Actions is still blocked before
any job step (#141), and `tsc --noEmit` still reports unrelated existing errors,
so this is not CI or deployment evidence.

See [multi-agent certification](docs/MULTI_AGENT_CERTIFICATION.md) for evidence
and acceptance tests. The Mongo swarm adapter, when present in a release,
requires an authenticated user/tenant/run scope and a suitable Mongo collection
with acknowledged atomic writes; its existence alone does not activate a swarm.
For a zero-additional-spend workflow, prefer already-approved local/free
inference and do not bypass release security checks.

## 🖥️ Coderax Desktop for Windows

[Download Coderax for Windows x64](https://github.com/CoderaxAI/Coderax/releases/download/desktop-v1.0.0/Coderax-Windows-x64.exe) · [Release details and SHA-256 checksum](https://github.com/CoderaxAI/Coderax/releases/tag/desktop-v1.0.0)

On first launch, enter the URL of your Coderax deployment. Remote servers require HTTPS; HTTP is accepted only for local loopback development. The installer is unsigned, and downloads require access to this private repository.

## 🚀 What's New in v0.8.8

- **Agent Management API (beta):** Create, discover, update, and delete Agents; manage Agent files and Skills; and authenticate machine clients through deployment-bound OIDC identities while preserving existing role and Agent access controls. Public OpenAPI and Swagger UI cover inference, events, Agent management, and Skill management.
- **Attached workspaces (highly experimental):** Select or save a per-Agent default workspace for each managed or personal code worker, then let Agents inspect trees, read and search files, author changes, and run Bash with bounded timeouts. Personal workers support bounded self-service enrollment, readiness status, and per-Agent Git identity.
- **Background tool controls:** Optionally cancel ordinary background tools, including attached Bash, while keeping detached Subagent execution independent.
- **Code approval controls:** Choose **Ask**, **Allow**, or **Deny** for file writes and command execution where administrators permit it, including a **Full access** mode for trusted attached environments. File Search and Run Code also honor role grants.
- **Manual context compaction:** Start a summarize-only turn before the context window fills while preserving recent conversation content according to the deployment's summarization policy.
- **Context Usage:** Inspect dialogue, retained tool traffic, Agent instructions, cache, cost, and runway pressure without double-counting category subsets.
- **Unified attachments:** Upload once and let Coderax route content to the model or extracted text, then provision File Search and Code tools only when needed.
- **Models:** Added GPT-6 Astra and GPT-6.1 Sol, with Responses API routing and tool-call support.
- **Agent and chat UI:** Unified tool activity, reasoning, search, and Agent workflows; added one draggable Pinned section for chats and favorites, morphing state icons, high-contrast themes, rich-text message copying, clearer sidebar titles, and refined live phase layouts.
- **Observability:** Inspect ordered model conversations, tool rounds, and costs in the Trace Viewer; export correlated application logs through OpenTelemetry, configure allowlisted Langfuse trace identity and metadata, tag browser diagnostics with client build IDs, and scope Insights to authorized Agents.
- **Reliability and security:** Strengthened Agent continuation and checkpoint recovery, Redis liveness detection, DocumentDB coordination, OpenID and MCP OAuth sessions, shared-link throttling, tenant isolation, attachment bounds, and upload error handling.

Read the [full v0.8.8 changelog](https://www.coderax/changelog/v0.8.8).

# ✨ Features

- 🖥️ **UI & Experience** inspired by ChatGPT with enhanced design and features

- 🤖 **AI Model Selection**:  
  - Anthropic (Claude), AWS Bedrock, OpenAI, Azure OpenAI, Google, Vertex AI, OpenAI Responses API (incl. Azure)
  - [Custom Endpoints](https://www.coderax/docs/quick_start/custom_endpoints): Use any OpenAI-compatible API with Coderax, no proxy required
  - Compatible with [Local & Remote AI Providers](https://www.coderax/docs/configuration/coderax_yaml/ai_endpoints):
    - Ollama, [AMD Lemonade](https://lemonade-server.ai/), groq, Cohere, Mistral AI, Apple MLX, koboldcpp, together.ai,
    - OpenRouter, Helicone, Perplexity, ShuttleAI, Deepseek, Qwen, and more

- 🔧 **[Code Interpreter API](https://www.coderax/docs/features/code_interpreter)**: 
  - Secure, Sandboxed Execution in Python, Node.js (JS/TS), Go, C/C++, Java, PHP, Rust, and Fortran
  - Seamless File Handling: Upload, process, and download files directly
  - No Privacy Concerns: Fully isolated and secure execution
  - Open-Source & Self-Hostable: powered by [ClickHouse/code-interpreter](https://github.com/ClickHouse/code-interpreter)

- 🔦 **Agents & Tools Integration**:  
  - **[Coderax Agents](https://www.coderax/docs/features/agents)**:
    - No-Code Custom Assistants: Build specialized, AI-driven helpers
    - Agent Marketplace: Discover and deploy community-built agents
    - Collaborative Sharing: Share agents with specific users and groups
    - Flexible & Extensible: Use MCP Servers, tools, file search, code execution, and more
    - [Skills](https://www.coderax/docs/features/skills): Create reusable `SKILL.md` instruction bundles for manual, automatic, or always-on agent workflows
    - [Agent Plugins](https://www.coderax/docs/features/agent_plugins): Experimentally bundle deployment Skills and MCP servers into startup-loaded packages
    - [Subagents](https://www.coderax/docs/features/subagents): Delegate focused work to isolated child agent runs with their own context windows
    - Agent Management API: Automate Agent, file, and Skill management with deployment-bound OIDC clients
    - Attached Code Workspaces: Let Agents inspect, search, edit, and run commands in managed or personal workspaces (highly experimental)
    - Compatible with Custom Endpoints, OpenAI, Azure, Anthropic, AWS Bedrock, Google, Vertex AI, Responses API, and more
    - [Model Context Protocol (MCP) Support](https://modelcontextprotocol.io/clients#coderax) for Tools

- 🔍 **Web Search**:  
  - Search the internet and retrieve relevant information to enhance your AI context
  - Combines search providers, content scrapers, and result rerankers for optimal results
  - **Customizable Jina Reranking**: Configure custom Jina API URLs for reranking services
  - **[Learn More →](https://www.coderax/docs/features/web_search)**

- 🪄 **Generative UI with Code Artifacts**:  
  - [Code Artifacts](https://youtu.be/GfTj7O4gmd0?si=WJbdnemZpJzBrJo3) create React, HTML, and Mermaid content directly in chat
  - Open previews fullscreen and export Mermaid diagrams as SVG or PNG

- 🎨 **Image Generation & Editing**
  - Text-to-image and image-to-image with [GPT-Image-1](https://www.coderax/docs/features/image_gen#1--openai-image-tools-recommended)
  - Text-to-image with [DALL-E (3/2)](https://www.coderax/docs/features/image_gen#2--dalle-legacy), [Stable Diffusion](https://www.coderax/docs/features/image_gen#3--stable-diffusion-local), [Flux](https://www.coderax/docs/features/image_gen#4--flux), or any [MCP server](https://www.coderax/docs/features/image_gen#5--model-context-protocol-mcp)
  - Produce stunning visuals from prompts or refine existing images with a single instruction

- 💾 **Presets & Context Management**:  
  - Create, Save, & Share Custom Presets  
  - Switch between AI Endpoints and Presets mid-chat
  - Edit, Resubmit, and Continue Messages with Conversation branching  
  - Create and share prompts with specific users and groups
  - [Fork Messages & Conversations](https://www.coderax/docs/features/fork) for Advanced Context control
  - Compact long conversations on demand while preserving recent context

- 💬 **Multimodal & File Interactions**:  
  - Upload and analyze images with Claude 3, GPT-4.5, GPT-4o, o1, Llama-Vision, and Gemini 📸  
  - Chat with Files using Custom Endpoints, OpenAI, Azure, Anthropic, AWS Bedrock, & Google 🗃️
  - Copy messages as formatted rich text for documents, email, and collaboration apps

- 🌎 **Multilingual UI**:
  - English, 中文 (简体), 中文 (繁體), العربية, Deutsch, Español, Français, Italiano
  - Polski, Português (PT), Português (BR), Русский, 日本語, Svenska, 한국어, Tiếng Việt
  - Türkçe, Nederlands, עברית, Català, Čeština, Dansk, Eesti, فارسی
  - Suomi, Magyar, Հայերեն, Bahasa Indonesia, ქართული, Latviešu, ไทย, ئۇيغۇرچە

- 🧠 **Reasoning UI**:  
  - Dynamic Reasoning UI for Chain-of-Thought/Reasoning AI models like DeepSeek-R1

- 🎨 **Customizable Interface**:  
  - Customizable Dropdown & Interface that adapts to both power users and newcomers
  - Light, dark, system, and high-contrast appearance modes

- 📈 **Observability**:
  - Export traces and logs with OpenTelemetry and connect Langfuse for Agent and model insights

- 🌊 **[Resumable Streams](https://www.coderax/docs/features/resumable_streams)**:  
  - Never lose a response: AI responses automatically reconnect and resume if your connection drops
  - Multi-Tab & Multi-Device Sync: Open the same chat in multiple tabs or pick up on another device
  - Production-Ready: Works from single-server setups to horizontally scaled deployments with Redis

- 🗣️ **Speech & Audio**:  
  - Chat hands-free with Speech-to-Text and Text-to-Speech  
  - Automatically send and play Audio  
  - Supports OpenAI, Azure OpenAI, and Elevenlabs

- 📥 **Import & Export Conversations**:  
  - Import Conversations from Coderax, ChatGPT, Chatbot UI  
  - Export conversations as screenshots, markdown, text, json

- 🔍 **Search & Discovery**:  
  - Search all messages/conversations

- 👥 **Multi-User & Secure Access**:
  - Multi-User, Secure Authentication with OAuth2, LDAP, & Email Login Support
  - Built-in Moderation, and Token spend tools

- 🎛️ **[Admin Panel](https://www.coderax/docs/features/admin_panel)**:
  - Browser-based UI to manage users, groups, roles, and configuration overrides
  - Edit settings and per-role/group permissions live, without redeploying
  - Bundled with the Docker Compose stacks for one-command setup

- ⚙️ **Configuration & Deployment**:  
  - Configure Proxy, Reverse Proxy, Docker, & many Deployment options  
  - Use [S3 with CloudFront](https://www.coderax/docs/configuration/cdn/cloudfront) for stable media links, edge delivery, signed cookies, and secured downloads
  - Use completely local or deploy on the cloud

- 📖 **Open-Source & Community**:  
  - Completely Open-Source & Built in Public  
  - Community-driven development, support, and feedback

[For a thorough review of our features, see our docs here](https://docs.coderax/) 📚

## 🪶 All-In-One AI Conversations with Coderax

Coderax is a self-hosted AI chat platform that unifies all major AI providers in a single, privacy-focused interface.

Beyond chat, Coderax provides AI Agents, Model Context Protocol (MCP) support, Artifacts, Code Interpreter, custom actions, conversation search, and enterprise-ready multi-user authentication.

Open source, actively developed, and built for anyone who values control over their AI infrastructure.

## 🖥️ Command-line client

`cli/` ships `@coderax/cli`, which exposes a `coderax` binary for chat, Work
mode, agents, models and Cloud status from a terminal:

```bash
cd cli &&
  npm link &&
  unset CODERAX_BASE_URL CODERAX_TOKEN &&
  coderax config set base-url https://your-deployment.example &&
  read -rsp "Coderax API token: " token &&
  echo &&
  printf '%s\n' "$token" | coderax login
unset token
coderax doctor
```

`coderax doctor` checks configuration, credentials and connectivity; `--help` lists
the remaining commands and exit codes. The example clears `CODERAX_BASE_URL` and
`CODERAX_TOKEN` first because both override stored configuration; piping the token
from `read` keeps it out of process arguments and shell history. See
[`cli/README.md`](cli/README.md).

---

## 🌐 Resources

**GitHub Repo:**
  - **RAG API:** [github.com/Coderax-AI/rag-api](https://github.com/Coderax-AI/rag-api)
  - **Website:** [github.com/Coderax-AI/coderax](https://github.com/Coderax-AI/coderax)

**Other:**
  - **Website:** [coderax](https://coderax)
  - **Documentation:** [coderax/docs](https://coderax/docs)
  - **Blog:** [coderax/blog](https://coderax/blog)

---

## 📝 Changelog

Keep up with the latest updates by visiting the releases page and notes:
- [Releases](https://github.com/Coderax-AI/Coderax/releases)
- [Changelog](https://www.coderax/changelog) 

**⚠️ Please consult the [changelog](https://www.coderax/changelog) for breaking changes before updating.**

---

## ⭐ Star History

<p align="center">
  <a href="https://www.star-history.com/?type=date&repos=danny-avila%2FCoderax">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=danny-avila/Coderax&type=date&theme=dark&legend=top-left&sealed_token=CXsk3L39t1nlibOv3pQloYwrz8R_yXxCAe1X3DG8sEnmu3PZvzSRZGf7JvisknF83yXqMwR6IcuKLolIQBulChAOseTYP1TDglfT6clOHXzspF-DJhmmsnGasrGpLfCeOEU56Bx761CJp9xDxza5rbyXW3F1GqWNtDf9pMroBq86vS70ilRWu16VyucF" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=danny-avila/Coderax&type=date&legend=top-left&sealed_token=CXsk3L39t1nlibOv3pQloYwrz8R_yXxCAe1X3DG8sEnmu3PZvzSRZGf7JvisknF83yXqMwR6IcuKLolIQBulChAOseTYP1TDglfT6clOHXzspF-DJhmmsnGasrGpLfCeOEU56Bx761CJp9xDxza5rbyXW3F1GqWNtDf9pMroBq86vS70ilRWu16VyucF" />
      <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=danny-avila/Coderax&type=date&legend=top-left&sealed_token=CXsk3L39t1nlibOv3pQloYwrz8R_yXxCAe1X3DG8sEnmu3PZvzSRZGf7JvisknF83yXqMwR6IcuKLolIQBulChAOseTYP1TDglfT6clOHXzspF-DJhmmsnGasrGpLfCeOEU56Bx761CJp9xDxza5rbyXW3F1GqWNtDf9pMroBq86vS70ilRWu16VyucF" />
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/4685" target="_blank" style="padding: 10px;">
    <img src="https://trendshift.io/api/badge/repositories/4685" alt="Coderax-AI%2FCoderax | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/>
  </a>
  <a href="https://runacap.com/ross-index/q1-24/" target="_blank" rel="noopener" style="margin-left: 20px;">
    <img style="width: 260px; height: 56px" src="https://runacap.com/wp-content/uploads/2024/04/ROSS_badge_white_Q1_2024.svg" alt="ROSS Index - Fastest Growing Open-Source Startups in Q1 2024 | Runa Capital" width="260" height="56"/>
  </a>
</p>

---

## ✨ Contributions

Contributions, suggestions, bug reports and fixes are welcome!

For new features, components, or extensions, please open an issue and discuss before sending a PR.

If you'd like to help translate Coderax into your language, we'd love your contribution! Improving our translations not only makes Coderax more accessible to users around the world but also enhances the overall user experience. Please check out our [Translation Guide](https://www.coderax/docs/translation).

---

## 💖 This project exists in its current state thanks to all the people who contribute

<a href="https://github.com/Coderax-AI/Coderax/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Coderax-AI/Coderax" />
</a>

---

## 🎉 Special Thanks

We thank [Locize](https://locize.com) for their translation management tools that support multiple languages in Coderax.

<p align="center">
  <a href="https://locize.com" target="_blank" rel="noopener noreferrer">
    <img src="https://github.com/user-attachments/assets/d6b70894-6064-475e-bb65-92a9e23e0077" alt="Locize Logo" height="50">
  </a>
</p>

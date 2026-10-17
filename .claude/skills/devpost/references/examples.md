# Example submissions

Past submissions the user likes. Use them for tone, depth, and structure. Do not copy their content.

- **Example 1 (Agentropolis Devpost)** is the best model for tone. Plain sentences, "we" voice, concrete details, an "In one sentence" summary, challenges paired with fixes.
- **Example 2 (LifeOS README)** is the model for README structure: tagline, demo link, ASCII architecture, stack, features, setup commands, API list.
- **Example 3 (LifeOS Devpost)** has strong technical depth. Its style needs fixing before reuse: it uses em dashes, some run-on sentences, and typos ("Injestion", "langugage"). Follow its level of technical detail, not its punctuation.

---

## Example 1: Agentropolis (Devpost)

### Inspiration

We wanted to see what happens when you put thousands of AI agents into a real city and let them live their lives together. Cities are messy systems made of people, neighborhoods, jobs, transit, and opinions. We were inspired by urban simulations and agent based models, but wanted to build something that felt alive instead of abstract.

So we picked Toronto as our sandbox. It is diverse, geographically distinct, and rich with public data. That made it a great place to ground agents in real neighborhoods, industries, and daily routines. The idea was simple: turn a real city into a living simulation where every dot on the map is an AI character with a home, a job, and things happening in their life.

### What it does

Agentropolis is a society simulation running on a 3D map of Toronto.

You can start a session and watch a city of AI characters come to life.

Agents are seeded from archetypes based on demographics like industry, neighborhood, and lifestyle. Each archetype generates followers, which are individual characters with homes, workplaces, happiness levels, and personalities.

Agents go about their day. They commute, work, eat, sleep, shop, exercise, socialize, attend events, and sometimes post tweets about it.

They also react to things happening in the city. You can inject events like a transit strike or a heat wave and watch thousands of agents adjust their behavior in real time.

The map itself is fully interactive. The frontend uses Mapbox GL with 3D buildings and terrain, so you can zoom around Toronto and watch agents move through neighborhoods. Updates stream in through WebSockets so the map stays in sync as the simulation clock advances.

You can also join the simulation yourself. The avatar creator lets you design a character with skin tone, hair, outfit, and accessories. When you click Join simulation, your character becomes a new agent in the city and appears on the map alongside everyone else.

In one sentence: Agentropolis is a living city simulation where thousands of AI agents move through Toronto, react to events, and you can drop yourself into the world with your own avatar.

### How we built it

The backend is written in Python using FastAPI with REST endpoints and WebSockets. Data is stored in NeonDB (PostgreSQL) and managed with SQLAlchemy async and asyncpg. We use Alembic for migrations and Railtracks to orchestrate the LLM agents.

Each simulation tick runs a two layer agent system. Archetype agents make one decision per demographic group, deciding what the group plans to do during the next period. Then follower variation agents personalize those plans for each individual agent.

To keep the system fast, we pre fetch all the context an agent might need. Memories, events, locations, and relationships are gathered ahead of time and passed in one message to the LLM. That avoids slow tool call loops.

The frontend is a Next.js application written in TypeScript with React and Zustand for state management. Mapbox GL renders the 3D Toronto map, building extrusion, and the cinematic landing flyover. Agents appear as dots on the map and update in real time through a WebSocket stream.

We also built a procedural avatar system. Instead of storing images, each agent has either an avatar seed or avatar parameters. These control features like skin tone, hair style, and clothing. The same schema powers both generated agents and user created avatars, which keeps everything consistent and scalable to tens of thousands of characters.

### Challenges we ran into

One challenge was latency. Even one LLM call per archetype per tick adds up when the simulation has many archetypes. Pre fetching context and running agents in parallel with a semaphore helped keep ticks reasonably fast.

Another issue was keeping the simulation stable when LLM responses fail. We added a deterministic fallback so agents still produce valid actions if an LLM call errors out. That way one bad response cannot break the whole simulation.

Making Toronto feel real also took effort. We built static datasets for neighborhoods, industries, and demographic mappings so agents could have plausible home and work locations. Getting those coordinates to line up with Mapbox and the WebSocket update stream required careful synchronization.

The avatar system had its own design challenge. We wanted diverse characters without storing photos or labeling race. The solution was a procedural system with continuous skin tones, multiple hair textures, and flexible clothing parameters.

### Accomplishments we are proud of

We built a full end to end pipeline that goes from Create session to a populated Toronto simulation running live on a 3D map.

The two tier agent architecture works surprisingly well. Archetypes decide what the group does, while follower agents personalize the details. This keeps costs manageable while still giving each character variation.

The simulation also feels grounded in a real place. Agents live in specific neighborhoods, commute to work districts, and react to events tied to actual parts of Toronto.

The procedural avatar system is another highlight. It supports thousands of characters, works with both generated and user created agents, and avoids storing personal images.

Finally, the deterministic fallback means the simulation keeps running even when LLM calls fail. That stability was important for demos and long sessions.

### What we learned

Pre loading context is often faster than relying on tool calls for agent tasks that mostly read information.

Orchestrating multiple agent layers requires careful scheduling and error handling so one failure does not block the whole system.

Grounding agents in real geography dramatically improves the realism of their behavior. When agents know their neighborhood and workplace, their actions become more believable.

Writing design docs before implementation also helped a lot. The procedural avatar specification kept the backend, API, and frontend aligned.

### What is next for Agentropolis

We want to replace map dots with instanced 3D avatars that walk around the city using shared meshes and GPU instancing.

We also plan to add richer city events such as policy changes, disasters, or economic shocks. Agents could react by protesting, moving neighborhoods, changing jobs, or shifting public opinion.

Another direction is building a stronger social network between agents so posts, rumors, and moods spread through the population.

We also want to make the user agent more playable. Instead of just joining the simulation, you could set goals or give commands and see how the rest of the city responds.

Finally, we want easier ways to share simulations. Things like session links, public city runs, and prompts like "What do you want to simulate?" could make Agentropolis feel more like a platform for experimenting with cities.

---

## Example 2: LifeOS (GitHub README)

# LifeOS

A multi-modal MCP layer for real life, built on a continuous video feed, semantic search and natural language video understanding.

## Overview

LifeOS is the foundational layer for smart glasses, providing context and automations on top of your real-life experiences. It uses video/audio ingestion, semantic search, and automation triggers to help you recall memories, automate tasks, and interact with your life data.

Demo: https://youtube.com/shorts/FRpwVwfdIlM?feature=share

## Architecture

```
┌───────────────┐    ┌────────────────────┐    ┌────────────────────┐
│   Frontend    │    │   Web API Service  │    │  Local Video       │
│   (Next.js)   │◄──►│   (FastAPI)        │◄──►│  Processing        │
└───────────────┘    └────────────────────┘    └────────────────────┘
                             │
                             ▼
                      ┌────────────────────┐
                      │  External APIs     │
                      │  (Qdrant, S3,      │
                      │   TwelveLabs, etc) │
                      └────────────────────┘
```

- Frontend: Mobile-first Next.js app, Tailwind CSS, Framer Motion
- Backend: FastAPI server, Docker, Asyncio, Redis Queue
- External Services: Qdrant (vector DB), S3 (raw video storage), Supabase, TwelveLabs (summarization + embedding), OpenAI

## Key Features

- Continuous Context Capture: Ingests video/audio, summarizes, and embeds into a vector DB.
- Semantic Memory Search: Natural language search over your life memories.
- Agentic Automations: LLMs trigger actions (e.g., add calendar events) based on context.
- Extensible Integrations: Foundational layer provides context and an automation pipeline to integrate external tools like Google Calendar and internal features like highlights clipping.

## Frontend

- Bottom navigation: Chatbot, Highlights, Recent Activity, Automations.
- Semantic search bar: Find relevant videos and context with natural language.
- Customizable dashboard widgets (e.g., time, summary of day).
- Chatbot: Query your life memory and trigger automations.

See `docs/frontend_vision.md` for full design philosophy.

## Backend

- Continuous video feed: Uses OpenCV and PyAudio to feed 10 second clips to the pipeline.
- Media processing pipeline: Async workers process and summarize video/audio, store in S3, embed in Qdrant.
- Memory system: Ingests, stores, and retrieves memories with semantic search.
- Automation engine: LLM-based triggers for external integrations.
- RESTful API: Auth, media, memory, automation, and summary endpoints.

See `server/README.md` for backend details.

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- Docker
- Redis
- AWS S3
- TwelveLabs API key
- OpenAI API key

### Backend

```bash
# Clone the repository
git clone https://github.com/owenguoo/LifeOS.git
cd LifeOS/server

# Copy and configure environment variables
cp env.example .env

# Start services (Qdrant, Redis, server)
docker-compose up -d

# Install dependencies (if running locally)
pip install -r requirements.txt
```

### Local Video Processing

```bash
cd LifeOS/server
pip install -r requirements.txt
python main.py both
```

### Frontend

```bash
cd LifeOS/client/lifeos
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

## API Endpoints

### Authentication

- `POST /api/v1/auth/register`: Register
- `POST /api/v1/auth/login`: Login
- `POST /api/v1/auth/logout`: Logout

### Media

- `POST /api/v1/media/upload`: Upload video/audio
- `GET /api/v1/media/{media_id}`: Get metadata
- `GET /api/v1/media/{media_id}/status`: Processing status

### Memory

- `POST /api/v1/memory/search`: Semantic search
- `GET /api/v1/memory/recent`: Recent memories
- `GET /api/v1/memory/{memory_id}`: Get memory

### Automations

- `POST /api/v1/automation/trigger`: Trigger automation
- `GET /api/v1/automation/rules`: List rules
- `POST /api/v1/automation/rules`: Create rule

### Summaries

- `GET /api/v1/summary/daily`: Daily summary
- `GET /api/v1/summary/weekly`: Weekly summary

### Chatbot

- `POST /api/v1/memory/chatbot`: Natural language memory search

---

## Example 3: LifeOS (Devpost)

Reuse the technical depth. Fix the style: it has em dashes, long sentences, and typos.

### Inspiration

While AI has become a prominent part of our lives, it suffers from a lack of context, forcing users to spend a lot of time priming the model with details from their lives. The inspiration came from Meta Glasses — imagine they were always recording and gathering context about your daily patterns, habits, and fed it all back into an agentic model. It would be the perfect personal assistant, study partner, field doctor, coach, and more.

The most popular apps nowadays build on this concept, such as Cursor, which a much better coding experience due to its context of the codebase, it understands the patterns.

Hence, we wanted to build the infrastructure layer for an in-person Model Context Protocol (MCP) implementation. It gathers context using a continuous video feed, which is summarised and embedded into our database for retrieval as context. It serves as the base layer for a new paradigm of apps built for smart glasses — integrating real life with automation and allowing other developers to create their own integrations.

### How LifeOS Was Built

The project can be split into the following sections:

**Injestion**
OpenCV and PyAudio are used to continuously feed in video and audio in real-time, where it is spliced into 10 second clips.

**Processing**
These clips are then put into a Redis Queue, which feeds into 3 workers, each running two tasks in parallel: creating multi-modal embeddings using TwelveLabs' Marengo 2.7 Model, and also creating natural language summaries with TwelveLab's Pegasus 1.2 while uploading the raw video to an S3 bucket. A uuid is generated, which relates the embedding, stored in a vector database (Qdrant), and a JSON (summary, S3 link) which is stored in a relational database (Supabase).

**Automation**
While the JSON is uploaded to Supabase, the summary is passed through an automation layer, which uses natural language processing to determine whether any of the preset automations should have their functions called. We created Google Calendar integrations, which detects when dates are mentioned and schedules them in, and also a personal highlight journal, which captures their most exciting moments. This is where the potential for people to build comes in — others can take advantage of this MCP to use the context for their own integrations and build on top of this infrastructure we provide.

**API Endpoints**
/search: The natural langugage query is passed through Marengo's embedding model, which vectorises the search, allowing for the most similar video to be found in the vector database. Then, using its uuid, the Supabase is queried, returning the actual summary and S3 link which displays the clip.
/chat: In order to communicate with an LLM, who has full context of your life, the user's question prompts the model to generate relevant queries, which are embedded and the summary is returned as above. Then, with that context, and the initial question, the LLM is able to return a comprehensive answer.

The remaining endpoints are accessed through a combination of CRUD routes, OAuth for creating a JWT token for login, and integrations using external APIs (Google Cloud -> Google Calendar).

### Challenges + Learnings

The main challenge we faced initially was the high latency when processing in series, especially with Marengo's multi-modal embedding bottlenecking operations where it wasn't necessary. For a 10 second video, it was taking upwards of 1 minute to process and add into the database — in order for the context to seem real-time, the retrieval and processing speeds needed to be faster. This was our first time working with infrastructure that was this complex, and that needed to scale especially well, since we wanted to create something that other developers could use.

That's why we began by drawing a comprehensive systems diagram (refer to images), which allowed us to parallelize certain tasks that were independent, saving a lot of time. Furthermore, the implementation of a queue and multiple workers allowed us to scale horizontally and load balance the incoming requests for lower latency.

This was a really good project to dive into systems design and infrastructure, and we were exposed to a lot of new tools that could streamline this process, like AsyncIO for concurrent processing. Furthermore, it was awesome exploring the TwelveLabs API, which was able to generate incredibly accurate and detailed descriptions of videos through the Pegasus model, and precise searches with the Marengo model. It was also our first time working with vector databases, which was a big challenge compared to traditional SQL and NoSQL based databases.

### Built With

Backend:
- Database / Storage: AWS S3, Qdrant, Supabase (PostgreSQL)
- API + Processing: FastAPI, AsyncIO, Redis Queue
- NLP + Video: OpenAI (GPT-4), TwelveLabs (Pegasus 1.2, Marengo 2.7), OpenCV
- Infra: Docker

Frontend:
- Framework: Next.js / React
- UI/UX: TailwindCSS, Framer Motion

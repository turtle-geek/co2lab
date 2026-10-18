# CO₂LAB

**Tagline:** Your old phone and laptop, working as an AI agent team.

## Inspiration

The best food deals live inside apps like Tim Hortons, McDonald's and Popeyes. No website, API or cloud agent can reach them. Your phone can, because it already has the apps and your accounts.

{TODO: the real moment that started this, for example a lunch where you missed a deal or an old phone sitting in a drawer.}

Most people also have an old phone or laptop doing nothing. Making a new computer has a carbon cost before it is turned on: a base Mac mini is about 32 kg CO₂e by Apple's figure. We wanted to put devices people already own to work instead of buying hardware for AI agents.

## What it does

You pair an old Android phone and a laptop, then type a request, such as "best lunch deals near UTSC today". Gemini plans the work, the hub hands each task to the device that can do it, and you watch their screens live.

- **App agent on Android:** the phone opens Tim Hortons, McDonald's and Popeyes, goes to the offers screen and screenshots it.
- **Web agent on the laptop:** a Playwright browser reads RedFlagDeals at the same time.
- **Handoff:** close the laptop lid mid-run and a cloud worker picks up its task within seconds.
- **One answer:** Gemini ranks the deals and shows where each one came from.
- **Burn meter:** each request shows its CO₂e, which old devices worked and for how long, and its AI cost.
- **Lab:** shows where the AI footprint comes from, by step, device and request. It also runs research experiments to cut it, from your own ideas or the agent's.

**In one sentence:** CO₂LAB is a personal agent fleet on your old devices that reads your apps and measures each request's CO₂e.

## How we built it

A Node hub on Vultr talks to every device and the dashboard over WebSockets.

- **Frontend:** React and Vite PWA. Each device is a drawn tree that reacts to its battery and heat.
- **Backend:** Fastify and `ws` in TypeScript. Zod schemas define one message contract for every part.
- **Android:** a Kotlin app using the Accessibility Service to read and tap other apps' screens.
- **Web worker:** Node and Playwright, on the laptop and as the cloud worker.
- **AI / APIs:** Gemini plans requests, steers devices, reads screenshots and writes the answer. Every call goes through the hub.
- **Database:** Tiger Data (Postgres with Timescale) stores telemetry, every Gemini call with its tokens, runs, experiments and trials.
- **Hardware:** a Samsung Galaxy A54 and an HP Elite Dragonfly G2.

The interesting decision was the split: Gemini decides what to do, plain code decides who does it. The scheduler matches tasks to device capabilities and health. It pauses hot devices and moves work off one that goes quiet.

## Challenges we ran into

**Installing on the phone.** USB debugging was not available on our A54. We served the APK over the local network and opened it with a QR code.

**A failing device drained the job queue.** One laptop kept failing batches and the queue emptied. We added backoff, retried on another device, and fail the run if more than 20% of the work is dropped.

**Smaller screenshots did not save tokens.** We assumed shrinking screenshots would cut AI cost. Our own experiment showed about 3,500 tokens per capture at 50%, 75% and 100% size. The model choice mattered instead.

## Accomplishments that we're proud of

- **Lid-close handoff works live:** the cloud worker took over the laptop's task in the same second.
- **A real research loop:** the agent cited FastV and FrugalGPT from our Papiers library and ran 21 trials on real deal screens. Our redirect steered the second experiment.
- **A measured result we shipped:** Gemini Flash-Lite found all 17 deals on our 3 test screens at $0.00046 per capture, against $0.00194 for Flash. We switched the device agents to Lite because of it.
- **Compute on old hardware:** the laptop and cloud worker analyzed 5,435 Steam review sentences in 34 seconds.

## What we learned

- Almost all of a request's footprint is the AI. By our estimate, our devices on Ontario's grid add under 0.01 g per request.
- Token counts for images do not shrink much with resolution, so the model tier is the lever.
- Free-tier limits are per model, not per key. When Flash ran out, older Flash models and then Lite kept runs alive on the same key.

## What's next for CO₂lab

- **Test Lite on more apps** before trusting it beyond deal screens.
- **Measure real device power** from the phone's battery current and the laptop's discharge rate.
- **Run Lab on every job** the agents do, not only deal reading.
- **Bring it to companies:** the same hub could schedule agent work on a company's retired laptops and phones.

## Built With

typescript, node.js, react, vite, fastify, websockets, zod, kotlin, android, playwright, gemini, postgresql, timescaledb, tiger-data, papiers, vultr, caddy, transformers.js

## Try it out

- Demo video: {TODO: link}
- GitHub: https://github.com/turtle-geek/co2lab
- Live site: {TODO: link, or remove this line}

# CO₂lab

**Tagline:** Your old phone and laptop, working as an AI agent team.

## Inspiration

AI moves fast, and everyone wants the newest phone and laptop to keep up. The old ones end up in a drawer. The UN's Global E-waste Monitor counted a record 62 million tonnes of e-waste in 2022, and only 22% of it was properly recycled.

Most of a device's carbon is spent making it, not running it. So a working phone in a drawer is wasted carbon.

I wanted to put those devices back to work. An old phone is still signed in to your apps and knows a lot about you. That makes it a good home for a personal AI agent, without buying anything new.

## What it does

CO₂lab turns your old phone and laptop into an agent team. You type a request, Gemini plans it, and each task goes to the device that can do it. You watch their screens live.

- **Phone agent:** opens apps you are signed in to, like Tim Hortons or McDonald's, and reads what is inside.
- **Laptop agent:** runs a browser to search the web at the same time.
- **Handoff:** close the laptop mid-task and a cloud worker takes over.
- **Burn meter:** each request shows its CO₂e, the old devices that worked on it, and its AI cost.
- **Lab:** shows where the AI footprint comes from and runs experiments to shrink it.

## How we built it

A hub on Vultr connects every device and the dashboard over WebSockets.

- **Hub:** TypeScript, Fastify and zod.
- **Phone:** a Kotlin app using Android's Accessibility Service to read and tap other apps.
- **Laptop and cloud worker:** Node and Playwright.
- **Dashboard:** React. Each device is a tree that reacts to its battery and heat.
- **AI:** Gemini plans each request, steers the devices and writes the answer.
- **Data:** Tiger Data (Postgres with Timescale) stores telemetry and every Gemini call.
- **Research:** papers from my Papiers library ground the Lab's experiments.

The key choice: Gemini decides what to do, and plain code decides which device does it. Hot or offline devices get skipped.

## Challenges we ran into

- **No USB debugging on my phone:** I served the app from the hub over Wi-Fi and installed it with a QR code.
- **A failing laptop drained the job queue:** I added retries on other devices and stop a run that loses more than 20% of its work.
- **Smaller screenshots did not save tokens:** about 3,500 tokens at 50%, 75% and 100% size. The model choice mattered instead.

## Accomplishments that we're proud of

- **Live handoff:** closing the laptop moves its task to the cloud worker within seconds.
- **A real research loop:** the Lab cited FastV and FrugalGPT from Papiers and ran 21 trials on real app screens. My feedback steered the next experiment.
- **A finding I shipped:** Flash-Lite read all 17 deals on my test screens at 76% lower cost than Flash. The device agents now run on Lite.

## What we learned

- The AI is almost all of the footprint. My devices add under 0.01 g of CO₂e per request on Ontario's grid, by my estimate.
- Picking a lighter model saves far more than shrinking images.
- Gemini's free-tier limits are per model. Falling back to older models kept the agents running.

## What's next for CO₂lab

- **Measure real power draw** from the phone and laptop batteries.
- **Run the Lab on every task**, not only reading app screens.
- **Bring it to companies** with closets full of retired laptops and phones.

## Built With

typescript, react, kotlin, gemini, tiger-data, vultr, papiers

## Try it out

- Demo video: {TODO: link}
- GitHub: https://github.com/turtle-geek/co2lab
- Live site: https://co2lab.work

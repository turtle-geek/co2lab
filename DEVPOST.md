# CO₂LAB

**Tagline:** Your old phone and laptop, working as an AI agent team.

## Inspiration

Running a personal AI agent around the clock takes a dedicated machine, and a lot of people bought Mac minis for exactly that. However, not everyone can afford one, and far more people have an old phone or laptop sitting in a drawer than a Mac mini on their desk. Running an agent on your daily device isn't a great alternative either, since long runs can wear out the battery. Old devices solve both problems: they cost nothing extra, and they aren't the device you rely on every day.

Most of these old phones and laptops still work, and a large share of a device's carbon footprint comes from manufacturing it. Buying new hardware for this adds to emissions and e-waste that old devices avoid. So I built CO₂LAB to put that idle hardware to work so nobody has to buy a new device.

## What it does

CO₂LAB turns your old phones and laptops into a coordinated team of agents. You type a request, and Gemini plans it by first scoping out what each device can do and what information it has before assigning subtasks. Each task then goes to the device that can do it while you watch their screens in real time.

The phone agent opens apps you're signed in to, like Tim Hortons or McDonald's, and reads what's inside. At the same time, the laptop agent runs a browser to search the web and analyzes the scraped information. If you close the laptop mid-task, a cloud worker takes over.

Each request gets a burn meter that shows its CO₂e, which old devices worked on it, and its AI cost.

The Lab is a built-in feature for diagnosing and fixing problems with your agents. It looks at the tasks you gave them, shows where the AI footprint and cost came from, and runs experiments to shrink them and make the results more consistent.

## How we built it

A hub on Vultr connects every device and the dashboard over WebSockets. The hub is written in TypeScript with Fastify and zod. The phone runs a Kotlin app that uses Android's Accessibility Service to read and tap other apps. The laptop and cloud worker use Node and Playwright, and the React dashboard shows each device as a tree that reacts to its battery and heat.

Each device reports to the hub what it can do, plus its battery and heat. Gemini plans each request from those reports, and plain code picks which device does each task, skipping any that are hot or offline. The device then does the work locally: the phone taps and swipes through other apps, and the laptop or cloud worker drives a browser. When a step needs judgement, the device sends its screen to the hub and Gemini chooses the next action. Gemini then reads what the devices found and writes the final answer. Tiger Data (Postgres with Timescale) stores telemetry and every Gemini call, and papers from my Papiers library ground the Lab's experiments.

## Challenges we ran into

My phone didn't have USB debugging, so I served the app from the hub over Wi-Fi and installed it with a QR code. A failing laptop also drained the job queue, which I fixed by adding retries on other devices and stopping any run that lost more than 20% of its work. I also expected smaller screenshots to save tokens, but they cost about 3,500 tokens at 50%, 75% and 100% size, so model choice mattered instead.

## Accomplishments that we're proud of

Closing the laptop moved its task to the cloud worker within seconds, and watching that live handoff was the most satisfying part of the build.

The Lab also ran a real research loop. It cited FastV and FrugalGPT from Papiers and ran 21 trials on real app screens, and my feedback steered each next experiment. That loop produced a finding I shipped: Flash-Lite read all 17 deals on my test screens at 76% lower cost than Flash, so the device agents now run on Lite.

## What we learned

The AI is almost all of the footprint. By my estimate, my devices added under 0.01 g of CO₂e per request on Ontario's grid. A lighter model saves far more than shrinking images, and because Gemini's free-tier limits are per model, falling back to older models kept the agents running.

## What's next for CO₂LAB

Next, I want to measure real power draw from the phone and laptop batteries and run the Lab on more complex tasks. I also want to scale CO₂LAB to enterprises, since they have so much old hardware sitting unused after upgrades. The Lab's experiments would help there too, because companies need consistent results across many different devices.

## Built With

typescript, react, kotlin, gemini, tiger-data, vultr, papiers

## Try it out

- Demo video: {TODO: link}
- GitHub: https://github.com/turtle-geek/co2lab
- Live site: https://co2lab.work

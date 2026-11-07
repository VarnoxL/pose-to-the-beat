# Pose to the Beat

Keep the flow. Don't break the beat. A two-player webcam dance-off for CougarJam.

```
npm install
npm run dev
```

- Game design and interfaces: [SPEC.md](SPEC.md)
- Agent and team rules: [CLAUDE.md](CLAUDE.md)

## Teammates: getting started

```
git clone https://github.com/VarnoxL/pose-to-the-beat.git
cd pose-to-the-beat
npm install
git switch -c <your-branch>        # create your own branch off main
git push -u origin <your-branch>
```

First prompt for your track's agent:

> Read SPEC.md and CLAUDE.md. You own the /src/<track> folder. Build to the data shapes in SPEC.md, using mock or replay data. Done means: <your track's "done when">. Run it and report back.

| Track | Done when |
|-------|-----------|
| vision | Two players' skeletons follow them smoothly on screen |
| scoring | Recorded sessions produce the right hits, misses, and eliminations |
| game | A full round plays with fake data |
| content | Song, voice lines, and 8–10 moves are ready |

Open a PR into `main` when your track hits "done when". All tracks merge by hour 14.

// Entry point. Track 3 (game) owns this file; it wires vision -> scoring -> game.
const canvas = document.querySelector<HTMLCanvasElement>("#stage")!;
const ctx = canvas.getContext("2d")!;
canvas.width = innerWidth;
canvas.height = innerHeight;
ctx.fillStyle = "#eee";
ctx.font = "48px system-ui";
ctx.textAlign = "center";
ctx.fillText("Pose to the Beat", canvas.width / 2, canvas.height / 2);

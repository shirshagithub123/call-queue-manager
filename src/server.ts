import { createApp } from "./app.js";

const port = Number(process.env.PORT) || 3000;
createApp().listen(port, () => {
  console.log(`Call Queue Manager running at http://localhost:${port}`);
});
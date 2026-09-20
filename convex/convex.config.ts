import workflow from "@convex-dev/workflow/convex.config.js";
import { defineApp } from "convex/server";

// Durable runs live in the workflow component; workflowRuns holds our own trail
// of what each step did, so pipeline state never hides in the component's logs.
const app = defineApp();
app.use(workflow);

export default app;

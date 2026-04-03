export { createGateway, type Gateway } from "./create.js";
export { AllProvidersExhaustedError, ProviderClientError } from "./router.js";
export type * from "./types.js";

// App-level singleton — created once, imported by routes
import { createGateway } from "./create.js";
const { registry, router } = createGateway();
export { registry, router };

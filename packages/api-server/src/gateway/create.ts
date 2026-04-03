import { ProviderRegistry } from "./registry.js";
import { GatewayRouter } from "./router.js";

export interface Gateway {
  registry: ProviderRegistry;
  router: GatewayRouter;
}

export function createGateway(): Gateway {
  const registry = new ProviderRegistry();
  const router = new GatewayRouter(registry);
  return { registry, router };
}

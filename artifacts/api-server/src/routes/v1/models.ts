import { Router, type IRouter } from "express";
import { registry } from "../../gateway/index.js";

const modelsRouter: IRouter = Router();

const META_MODELS = [
  {
    id: "free",
    object: "model",
    created: 1700000000,
    owned_by: "freellm",
    provider: "freellm",
  },
  {
    id: "free-fast",
    object: "model",
    created: 1700000000,
    owned_by: "freellm",
    provider: "freellm",
  },
  {
    id: "free-smart",
    object: "model",
    created: 1700000000,
    owned_by: "freellm",
    provider: "freellm",
  },
];

modelsRouter.get("/", (_req, res) => {
  const providerModels = registry.getAllModels();
  const all = [...META_MODELS, ...providerModels];

  res.json({
    object: "list",
    data: all,
  });
});

export default modelsRouter;

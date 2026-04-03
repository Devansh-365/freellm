import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import v1Router from "./v1/index.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/v1", v1Router);

export default router;

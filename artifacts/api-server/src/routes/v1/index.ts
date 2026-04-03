import { Router, type IRouter } from "express";
import chatRouter from "./chat.js";
import modelsRouter from "./models.js";
import statusRouter from "./status.js";

const v1Router: IRouter = Router();

v1Router.use("/chat", chatRouter);
v1Router.use("/models", modelsRouter);
v1Router.use("/status", statusRouter);

export default v1Router;

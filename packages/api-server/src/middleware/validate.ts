import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";

export function validate<T>(schema: ZodType<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: {
          message: result.error.issues.map((i) => i.message).join("; "),
          type: "invalid_request_error",
        },
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

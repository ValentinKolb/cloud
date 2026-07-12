import { ErrorResponseSchema } from "@valentinkolb/cloud/contracts";
import { type AuthContext, jsonResponse, v } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { z } from "zod";
import { gridsService } from "../service";
import { FormSubmitSchema, PublicFormSchema, type SubmitFormDeps, submitFormResponse, toPublicForm } from "./form-api-shared";

type PublicFormRoutesDeps = SubmitFormDeps & {
  getByPublicToken?: typeof gridsService.form.getByPublicToken;
};

export const createPublicFormRoutes = (deps: PublicFormRoutesDeps = {}) =>
  new Hono<AuthContext>()
    .get(
      "/public/:token",
      describeRoute({
        tags: ["Grids:Form"],
        summary: "Fetch a public form by its share token (anonymous)",
        responses: {
          200: jsonResponse(PublicFormSchema, "Public form (sensitive fields stripped)"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      async (context) => {
        const form = await (deps.getByPublicToken ?? gridsService.form.getByPublicToken)(context.req.param("token")!);
        if (!form) return context.json({ message: "Form not found" }, 404);
        return context.json(toPublicForm(form));
      },
    )
    .post(
      "/public/:token/submit",
      describeRoute({
        tags: ["Grids:Form"],
        summary: "Submit a public form (anonymous, no auth required)",
        responses: {
          201: jsonResponse(z.object({ recordId: z.string().uuid() }), "Created"),
          400: jsonResponse(ErrorResponseSchema, "Invalid input"),
          404: jsonResponse(ErrorResponseSchema, "Not found"),
        },
      }),
      v("json", FormSubmitSchema),
      async (context) => {
        const form = await (deps.getByPublicToken ?? gridsService.form.getByPublicToken)(context.req.param("token")!);
        if (!form) return context.json({ message: "Form not found" }, 404);
        return submitFormResponse(context, form, context.req.valid("json"), null, deps);
      },
    );

export const publicFormRoutes = createPublicFormRoutes();

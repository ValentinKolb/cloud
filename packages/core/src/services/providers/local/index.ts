import * as auth from "./auth";
import * as users from "./users";

export const local = { auth, users } as const;

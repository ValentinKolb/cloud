import * as access from "./access";
import { geo } from "./geo";
import { images } from "./images";
import { password } from "./password";
import * as result from "./result";

export const services = {
  access,
  geo,
  images,
  password,
  result,
} as const;

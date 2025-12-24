import { createDefine } from "fresh";

// This specifies the type of "ctx.state" which is used to share
// data among middlewares, layouts and routes.
export interface State {
  // Add shared state properties here as needed
}

export const define = createDefine<State>();

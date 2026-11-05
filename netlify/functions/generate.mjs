import handler from "../../api/generate.js";
import { adaptVercelHandler } from "./_adapter.mjs";

export default adaptVercelHandler(handler);

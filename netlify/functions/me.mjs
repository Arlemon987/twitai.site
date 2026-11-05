import handler from "../../api/me.js";
import { adaptVercelHandler } from "./_adapter.mjs";

export default adaptVercelHandler(handler);

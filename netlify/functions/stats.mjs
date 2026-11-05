import handler from "../../api/stats.js";
import { adaptVercelHandler } from "./_adapter.mjs";

export default adaptVercelHandler(handler);

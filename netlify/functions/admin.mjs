import handler from "../../api/admin.js";
import { adaptVercelHandler } from "./_adapter.mjs";

export default adaptVercelHandler(handler);

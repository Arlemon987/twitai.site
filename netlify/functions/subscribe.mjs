import handler from "../../api/subscribe.js";
import { adaptVercelHandler } from "./_adapter.mjs";

export default adaptVercelHandler(handler);

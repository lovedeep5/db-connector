import { registerNode } from "../registry";
import { dbQueryNode } from "./db-query";
import { httpRequestNode } from "./http-request";
import { sendEmailNode } from "./send-email";
import { toFileNode } from "./to-file";
import { jsCodeNode } from "./js-code";
import { ifElseNode } from "./if-else";
import { filterNode } from "./filter";
import { setVariableNode } from "./set-variable";
import { extractPathNode } from "./extract-path";
import { delayNode } from "./delay";
import { downloadFileNode } from "./download-file";
import { loopNode } from "./loop";
import { loopEndNode } from "./loop-end";

let registered = false;

export function ensureNodesRegistered(): void {
  if (registered) return;
  registered = true;
  registerNode(dbQueryNode as never);
  registerNode(httpRequestNode as never);
  registerNode(sendEmailNode as never);
  registerNode(toFileNode as never);
  registerNode(jsCodeNode as never);
  // Phase 2A — control flow & transforms
  registerNode(ifElseNode as never);
  registerNode(filterNode as never);
  registerNode(setVariableNode as never);
  registerNode(extractPathNode as never);
  registerNode(delayNode as never);
  registerNode(downloadFileNode as never);
  registerNode(loopNode as never);
  registerNode(loopEndNode as never);
}

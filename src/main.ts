import { initChartPanel } from "./app/chartPanel";
import { initElements } from "./app/elements";
import {
  bootstrapApp,
  registerBeforeUnloadHandler,
  registerGlobalEventHandlers,
  registerWatchlistEventHandlers,
} from "./app/lifecycle";
import { APP_TEMPLATE } from "./app/template";

const root = document.querySelector("#app") as HTMLDivElement;
root.innerHTML = APP_TEMPLATE;

initElements(root);
initChartPanel();

registerWatchlistEventHandlers();
registerGlobalEventHandlers();
registerBeforeUnloadHandler();

void bootstrapApp();

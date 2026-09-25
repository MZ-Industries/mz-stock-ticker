import { loadOlderBars } from "./app/actions";
import { initChartPanel } from "./app/chartPanel";
import { addChartLine, initChartLines, syncLineToolbar } from "./app/chartLines";
import { initElements } from "./app/elements";
import {
  bootstrapApp,
  registerBeforeUnloadHandler,
  registerGlobalEventHandlers,
  registerWatchlistEventHandlers,
} from "./app/lifecycle";
import { initPlatform } from "./app/platform";
import { APP_TEMPLATE } from "./app/template";

async function main(): Promise<void> {
  // Layout and input handling depend on the platform, so learn it before the
  // first render.
  await initPlatform();

  const root = document.querySelector("#app") as HTMLDivElement;
  root.innerHTML = APP_TEMPLATE;

  initElements(root);
  initChartPanel({
    onNeedOlderData: () => {
      void loadOlderBars();
    },
    onLinePlaced: addChartLine,
    onLinesShown: syncLineToolbar,
  });
  initChartLines();

  registerWatchlistEventHandlers();
  registerGlobalEventHandlers();
  registerBeforeUnloadHandler();

  await bootstrapApp();
}

void main();
